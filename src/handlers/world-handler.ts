/**
 * @file src/handlers/world-handler.ts
 * @description 会話練習の空間（Yamato Town）: お店の店員などの AI と、声で話す（OpenAI Realtime）
 *
 *   POST /api/world/start { place, sdp }
 *        → 場所の設定（src/world/places.ts）で AI の役割を決め、クレジットを 1 回だけ引いて（3 分: 15）、
 *          サーバーが OpenAI に会話をつなぐ（API キーはブラウザに出さない）。ブラウザには WebRTC の答え（SDP）を返す
 *        ・ブラウザは声を受け取るだけ（recvonly）。生徒の発言は、確かめた文字をデータチャンネルで送る
 *   POST /api/world/end … EOY Oral Superb と同じ処理（handleOralSuperbEnd）。会話を切り、英語が出た回数を記録する
 *   POST /api/world/feedback { sessionId, transcript } → 会話のあとのフィードバック（learning pace に合わせる）。
 *        会話のクレジットに入っている（追加のクレジットはなし）。1 回の会話につき 3 回・3 時間まで（use_oral_realtime_feedback）
 *
 * 記録は oral_realtime_sessions（focus = 'world:<場所>'、SQL 55）。「1 人 1 つまで」「時間が来たらサーバーが切る」は
 * EOY Oral Superb と共通（hangupExpiredRealtimeCalls）。会話の中身（声・文字）は保存しない。
 */
import type { Context } from 'hono';
import { getSupabaseAdmin } from '../services/supabase-admin';
import { reserveCredits, refundCredits } from './credit-handler';
import { WORLD_PLACES } from '../world/places';
import { callGemini } from '../services/gemini';
import { normalizeKiku } from '../utils/japanese-style';
import { buildWorldFeedbackPrompt } from '../prompts/world-feedback';
import { normalizePace } from '../prompts/pace-feedback';

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
  // 生徒の声は OpenAI に流さない（2026-11-21 に変更）。
  //   生徒は録音 → 文字起こし（/api/stt）→ 文字を確かめて「送る」。ブラウザが文字を会話に入れて返事を頼む。
  //   聞き間違いで店員の返事がずれるのを防ぐため（レッスンのスピーキングタスク・Oral Drill と同じ考え方）。
  //   そのため、話の切れ目の自動判定（turn_detection）と、声の文字起こしは使わない。店員の声（出力）だけ使う
  const sessionConfig = {
    type: 'realtime',
    model: c.env.REALTIME_MODEL || 'gpt-realtime-mini',
    instructions: place.buildInstructions(nickname),
    // 店員は 1 回に 1 文だけ話すので、返事は短くてよい（費用も抑える）
    max_output_tokens: 250,
    audio: {
      input: { turn_detection: null },
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

// ---------------------------------------------------------------------------------------------
// feedback（会話が終わったあと、毎回 1 回。learning pace に合わせる）
// ---------------------------------------------------------------------------------------------
export async function handleWorldFeedback(c: Context) {
  const userId = c.get('userId') as string;
  const body = (await c.req.json().catch(() => null)) as any;
  const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : '';
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return c.json({ error: 'BAD_REQUEST', message: 'Invalid conversation.' }, 400);

  const transcript: { speaker: 'student' | 'clerk'; text: string }[] = (Array.isArray(body?.transcript) ? body.transcript : [])
    .slice(0, 120)
    .map((t: any) => ({
      speaker: t?.speaker === 'student' ? ('student' as const) : ('clerk' as const),
      text: typeof t?.text === 'string' ? t.text.replace(/[<>]/g, '').trim().slice(0, 300) : '',
    }))
    .filter((t: { text: string }) => t.text);
  if (!transcript.some((t) => t.speaker === 'student')) {
    return c.json({ error: 'NO_ANSWERS', message: "You didn't say anything, so there is no feedback this time." }, 400);
  }

  const admin = getSupabaseAdmin(c.env);
  const { data: session, error } = await admin.rpc('use_oral_realtime_feedback', { p_session_id: sessionId, p_user_id: userId });
  if (error) {
    console.error('❌ [world] use_oral_realtime_feedback failed:', error.message);
    return c.json({ error: 'UNAVAILABLE', message: 'Feedback is not available right now. Please try again.' }, 503);
  }
  const focus = String((session as any)?.focus ?? '');
  const place = focus.startsWith('world:') ? WORLD_PLACES[focus.slice('world:'.length)] : undefined;
  if (!session || !place) {
    return c.json({ error: 'SESSION_ENDED', message: 'Feedback for this conversation is no longer available.' }, 409);
  }

  const { data: profile } = await admin.from('profiles').select('learning_pace, nickname').eq('id', userId).single();
  const pace = normalizePace(profile?.learning_pace);
  const nickname = typeof profile?.nickname === 'string' ? profile.nickname.replace(/[<>]/g, '').slice(0, 30) : '';
  const lines = transcript.map((t) => `${t.speaker === 'student' ? 'STUDENT' : 'CLERK'}: ${t.text}`).join('\n');
  try {
    const feedback = await callGemini(c.env, {
      system: buildWorldFeedbackPrompt({ pace, scene: place.feedback.scene, goals: place.feedback.goals, studentName: nickname }),
      contents: [{ role: 'user', text: `TRANSCRIPT:\n${lines}` }],
      temperature: 0.4,
      maxOutputTokens: 2048,
      thinkingBudget: 512,
    });
    if (!feedback) throw new Error('empty feedback');
    return c.json({ feedback: normalizeKiku(feedback), pace });
  } catch (err: any) {
    console.error('❌ [world] feedback AI failed:', err?.message || String(err));
    return c.json({ error: 'AI_FAILED', message: 'Sorry, we could not create your feedback. Please press "Try again".' }, 500);
  }
}
