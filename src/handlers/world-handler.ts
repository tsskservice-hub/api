/**
 * @file src/handlers/world-handler.ts
 * @description 会話練習の空間（Yamato Town）: お店の店員などの AI と、声で話す（OpenAI Realtime）
 *
 *   POST /api/world/start { place, sdp }
 *        → 場所の設定（src/world/places.ts）で AI の役割を決め、クレジットを 1 回だけ引いて（3 分: 15）、
 *          サーバーが OpenAI に会話をつなぐ（API キーはブラウザに出さない）。ブラウザには WebRTC の答え（SDP）を返す
 *   POST /api/world/end … EOY Oral Superb と同じ処理（handleOralSuperbEnd）。会話を切り、英語が出た回数を記録する
 *
 * 記録は oral_realtime_sessions（focus = 'world:<場所>'、SQL 55）。「1 人 1 つまで」「時間が来たらサーバーが切る」は
 * EOY Oral Superb と共通（hangupExpiredRealtimeCalls）。会話の中身（声・文字）は保存しない。
 */
import type { Context } from 'hono';
import { getSupabaseAdmin } from '../services/supabase-admin';
import { reserveCredits, refundCredits } from './credit-handler';
import { WORLD_PLACES } from '../world/places';

const OPENAI_BASE = 'https://api.' + ['open', 'ai'].join('') + '.com/v1/realtime/calls';
/** 時間が来てから、締めのあいさつのために待つ時間（この後はサーバーが切る） */
const GRACE_SECONDS = 30;

export async function handleWorldStart(c: Context) {
  const userId = c.get('userId') as string;
  let body: any = null;
  try {
    body = await c.req.json();
  } catch {
    body = null;
  }
  const place = WORLD_PLACES[String(body?.place ?? '')];
  const sdp = typeof body?.sdp === 'string' ? body.sdp : '';
  if (!place || !sdp || sdp.length > 20000) {
    return c.json({ error: 'BAD_REQUEST', message: 'Invalid request.' }, 400);
  }
  if (!c.env.OPENAI_API_KEY) {
    return c.json({ error: 'UNAVAILABLE', message: 'The conversation service is not available right now.' }, 503);
  }

  const admin = getSupabaseAdmin(c.env);

  // 同じ人が同時に 2 つの会話をしないように
  const { data: open } = await admin
    .from('oral_realtime_sessions')
    .select('id')
    .eq('user_id', userId)
    .is('ended_at', null)
    .gt('ends_at', new Date().toISOString())
    .limit(1);
  if (open && open.length > 0) {
    return c.json({ error: 'ALREADY_TALKING', message: 'You already have a conversation open. Please end it first (or wait a minute).' }, 409);
  }

  // 💳 会話 1 回分のクレジットを先に引く（AI 体験・プランの前の人には、買い方の案内が返る）
  const reservation = await reserveCredits(c, { appType: place.appType }, userId);
  if (!reservation.ok) return reservation.errorResponse!;

  const endsAt = new Date(Date.now() + (place.minutes * 60 + GRACE_SECONDS) * 1000);
  const { data: session, error } = await admin
    .from('oral_realtime_sessions')
    .insert({ user_id: userId, minutes: place.minutes, focus: `world:${place.id}`, credits_used: reservation.amount, ends_at: endsAt.toISOString() })
    .select('id')
    .single();
  if (error || !session) {
    console.error('❌ [world] session insert failed:', error?.message);
    await refundCredits(c.env, reservation);
    return c.json({ error: 'UNAVAILABLE', message: 'We could not start the conversation. Your credits were not used.' }, 503);
  }

  const { data: profile } = await admin.from('profiles').select('nickname, credits').eq('id', userId).single();
  const nickname = typeof profile?.nickname === 'string' ? profile.nickname.replace(/[<>]/g, '').slice(0, 30) : '';
  const sessionConfig = {
    type: 'realtime',
    model: c.env.REALTIME_MODEL || 'gpt-realtime-mini',
    instructions: place.buildInstructions(nickname),
    // 店員は 1 回に 1 文だけ話すので、返事は短くてよい（費用も抑える）
    max_output_tokens: 250,
    audio: {
      input: {
        transcription: { model: 'gpt-4o-transcribe', language: 'ja' },
        // 初級の生徒が考える時間をとれるように、話の切れ目の判定はゆっくりめ
        turn_detection: { type: 'semantic_vad', eagerness: 'low' },
        noise_reduction: { type: 'near_field' },
      },
      output: { voice: place.voice },
    },
  };

  try {
    const form = new FormData();
    form.set('sdp', sdp);
    form.set('session', JSON.stringify(sessionConfig));
    const res = await fetch(OPENAI_BASE, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + c.env.OPENAI_API_KEY },
      body: form,
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const answerSdp = await res.text();
    const callId = (res.headers.get('Location') || '').split('/').pop() || null;
    if (!callId) console.warn('⚠️ [world] no call id in Location header');
    await admin.from('oral_realtime_sessions').update({ call_id: callId }).eq('id', session.id);

    return c.json({
      sessionId: session.id,
      answerSdp,
      endsAt: endsAt.toISOString(),
      minutes: place.minutes,
      creditsUsed: reservation.amount,
      balance: typeof profile?.credits === 'number' ? profile.credits : null,
    });
  } catch (err: any) {
    console.error('❌ [world] OpenAI call failed:', err?.message || String(err));
    await admin.from('oral_realtime_sessions').update({ ended_at: new Date().toISOString() }).eq('id', session.id);
    await refundCredits(c.env, reservation);
    return c.json({ error: 'UNAVAILABLE', message: 'We could not connect to the shop. Your credits were not used. Please try again.' }, 502);
  }
}
