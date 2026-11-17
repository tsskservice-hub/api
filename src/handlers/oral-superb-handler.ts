/**
 * @file src/handlers/oral-superb-handler.ts
 * @description EOY Oral Superb（OpenAI Realtime で AI ヤマトと自由に話す。5 分 / 10 分）
 *
 *   POST /api/oral-superb/start    { minutes, focus, subtopic, sdp }
 *        → クレジットを 1 回だけ引き（5 分: 25 / 10 分: 50）、サーバーが OpenAI に会話をつなぐ（API キーはブラウザに出さない）。
 *          OpenAI の会話の ID（call_id）と終わる時刻を記録して、ブラウザには WebRTC の答え（SDP）を返す
 *   POST /api/oral-superb/end      { sessionId, englishLeaks }
 *        → 会話を切る（OpenAI の hangup）。英語が出た回数を記録する
 *   POST /api/oral-superb/feedback { sessionId, transcript }
 *        → 会話が終わったあとに 1 回だけ、learning pace に合わせたフィードバック（評価基準にもとづく。mock と同じ作り）
 *
 * 時間を過ぎても切られていない会話は、1 分ごとの定期処理（hangupExpiredRealtimeCalls）がサーバー側から切る。
 * 会話の中身（生徒の声・文字）は保存しない。
 */
import type { Context } from 'hono';
import { getSupabaseAdmin } from '../services/supabase-admin';
import { reserveCredits, refundCredits } from './credit-handler';
import { callGemini } from '../services/gemini';
import { normalizeKiku } from '../utils/japanese-style';
import { cleanSeconds, summarizeTiming } from '../services/oral-timing';
import { buildRealtimeInstructions, type RealtimeFocus } from '../prompts/eoy-oral-superb-realtime';
import { buildMockFeedbackPrompt } from '../prompts/eoy-oral-mock-exam';
import { loadOralReferences } from './oral-mock-handler';

const OPENAI_BASE = 'https://api.' + ['open', 'ai'].join('') + '.com/v1/realtime/calls';
/** 時間が来てから、締めのあいさつのために待つ時間（この後はサーバーが切る） */
const GRACE_SECONDS = 60;
const FOCUSES: RealtimeFocus[] = ['free', 'sec1', 'sec2'];

function clean(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/<[^>]*>/g, '').replace(/[\r\t]+/g, ' ').trim().slice(0, max);
}

async function readJson(c: Context): Promise<any | null> {
  try {
    return await c.req.json();
  } catch {
    return null;
  }
}

/** OpenAI の会話を切る（失敗してもかまわない。もう終わっていることもある） */
async function hangup(env: any, callId: string): Promise<void> {
  if (!env.OPENAI_API_KEY || !callId) return;
  try {
    await fetch(`${OPENAI_BASE}/${encodeURIComponent(callId)}/hangup`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + env.OPENAI_API_KEY },
      signal: AbortSignal.timeout(8000),
    });
  } catch (err: any) {
    console.warn('⚠️ [oral-superb] hangup failed:', err?.message || String(err));
  }
}

// ---------------------------------------------------------------------------------------------
// start
// ---------------------------------------------------------------------------------------------
export async function handleOralSuperbStart(c: Context) {
  const userId = c.get('userId') as string;
  const body = await readJson(c);
  const minutes = body?.minutes === 5 ? 5 : body?.minutes === 10 ? 10 : null;
  const focus: RealtimeFocus = FOCUSES.includes(body?.focus) ? body.focus : 'free';
  const subtopic = clean(body?.subtopic, 80);
  const sdp = typeof body?.sdp === 'string' ? body.sdp : '';
  if (!minutes || !sdp || sdp.length > 20000) {
    return c.json({ error: 'BAD_REQUEST', message: 'Invalid request.' }, 400);
  }
  if (!c.env.OPENAI_API_KEY) {
    return c.json({ error: 'UNAVAILABLE', message: 'The conversation service is not available right now.' }, 503);
  }

  const admin = getSupabaseAdmin(c.env);

  // 同じ人が同時に 2 つの会話をしないように（終わっていない会話があれば始めない）
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

  // 💳 会話 1 回分のクレジットを先に引く
  const reservation = await reserveCredits(c, { appType: `eoy-oral-superb-${minutes}` }, userId);
  if (!reservation.ok) return reservation.errorResponse!;

  const endsAt = new Date(Date.now() + (minutes * 60 + GRACE_SECONDS) * 1000);
  const { data: session, error } = await admin
    .from('oral_realtime_sessions')
    .insert({ user_id: userId, minutes, focus, credits_used: reservation.amount, ends_at: endsAt.toISOString() })
    .select('id')
    .single();
  if (error || !session) {
    console.error('❌ [oral-superb] session insert failed:', error?.message);
    await refundCredits(c.env, reservation);
    return c.json({ error: 'UNAVAILABLE', message: 'We could not start the conversation. Your credits were not used.' }, 503);
  }

  const { data: profile } = await admin.from('profiles').select('nickname, credits').eq('id', userId).single();
  const sessionConfig = {
    type: 'realtime',
    model: c.env.REALTIME_MODEL || 'gpt-realtime-mini',
    instructions: buildRealtimeInstructions({ focus, subtopic, minutes, nickname: clean(profile?.nickname, 30) }),
    max_output_tokens: 600,
    audio: {
      input: {
        // 生徒の声を文字にする（画面の記録と、最後のフィードバックのため）
        // 聞き取りの正確さを上げるため、mini ではない gpt-4o-transcribe を使う。
        // 場面の手がかり（prompt）は渡さない: 雑音しかないとき、手がかりの文を生徒の発言として書いてしまうため
        transcription: { model: 'gpt-4o-transcribe', language: 'ja' },
        // 生徒が考える時間をとれるように、話の切れ目の判定はゆっくりめ
        turn_detection: { type: 'semantic_vad', eagerness: 'low' },
        noise_reduction: { type: 'near_field' },
      },
      output: { voice: 'cedar' },
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
    // 会話の ID は Location ヘッダーの最後（/v1/realtime/calls/rtc_xxx）
    const callId = (res.headers.get('Location') || '').split('/').pop() || null;
    if (!callId) console.warn('⚠️ [oral-superb] no call id in Location header');
    await admin.from('oral_realtime_sessions').update({ call_id: callId }).eq('id', session.id);

    return c.json({
      sessionId: session.id,
      answerSdp,
      endsAt: endsAt.toISOString(),
      creditsUsed: reservation.amount,
      balance: typeof profile?.credits === 'number' ? profile.credits : null,
    });
  } catch (err: any) {
    console.error('❌ [oral-superb] OpenAI call failed:', err?.message || String(err));
    await admin.from('oral_realtime_sessions').update({ ended_at: new Date().toISOString() }).eq('id', session.id);
    await refundCredits(c.env, reservation);
    return c.json({ error: 'UNAVAILABLE', message: 'We could not connect to AI Yamato. Your credits were not used. Please try again.' }, 502);
  }
}

// ---------------------------------------------------------------------------------------------
// end
// ---------------------------------------------------------------------------------------------
export async function handleOralSuperbEnd(c: Context) {
  const userId = c.get('userId') as string;
  const body = await readJson(c);
  const sessionId = clean(body?.sessionId, 64);
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return c.json({ error: 'BAD_REQUEST' }, 400);
  const englishLeaks = Math.max(0, Math.min(999, Number(body?.englishLeaks) || 0));

  const admin = getSupabaseAdmin(c.env);
  const { data: session } = await admin
    .from('oral_realtime_sessions')
    .select('id, call_id, ended_at')
    .eq('id', sessionId)
    .eq('user_id', userId)
    .single();
  if (!session) return c.json({ error: 'NOT_FOUND' }, 404);
  if (!session.ended_at && session.call_id) await hangup(c.env, session.call_id);
  await admin
    .from('oral_realtime_sessions')
    .update({ ended_at: session.ended_at || new Date().toISOString(), english_leaks: englishLeaks })
    .eq('id', sessionId);
  if (englishLeaks > 0) console.log(`🔤 [oral-superb] English leaks in session ${sessionId}: ${englishLeaks}`);
  return c.json({ ok: true });
}

// ---------------------------------------------------------------------------------------------
// feedback（会話が終わったあと、まとめて 1 回）
// ---------------------------------------------------------------------------------------------
export async function handleOralSuperbFeedback(c: Context) {
  const userId = c.get('userId') as string;
  const body = await readJson(c);
  const sessionId = clean(body?.sessionId, 64);
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return c.json({ error: 'BAD_REQUEST', message: 'Invalid conversation.' }, 400);

  const transcript: { speaker: string; text: string; edited: boolean; latency?: number; duration?: number }[] = (
    Array.isArray(body?.transcript) ? body.transcript : []
  )
    .slice(0, 300)
    .map((t: any) => ({
      speaker: t?.speaker === 'student' ? 'student' : 'examiner',
      text: clean(t?.text, 600),
      // 文字起こしがまちがっていて、生徒が会話のあとに直した行
      edited: t?.speaker === 'student' && t?.edited === true,
      // 画面が測った時間（答え始めるまで・話した長さ）
      latency: t?.speaker === 'student' ? cleanSeconds(t?.latency, 120) : undefined,
      duration: t?.speaker === 'student' ? cleanSeconds(t?.duration, 180) : undefined,
    }))
    .filter((t: { text: string }) => t.text);
  if (!transcript.some((t) => t.speaker === 'student')) {
    return c.json({ error: 'NO_ANSWERS', message: 'There is nothing you said to give feedback on.' }, 400);
  }

  const admin = getSupabaseAdmin(c.env);
  const { data: session, error } = await admin.rpc('use_oral_realtime_feedback', { p_session_id: sessionId, p_user_id: userId });
  if (error) {
    console.error('❌ [oral-superb] use_oral_realtime_feedback failed:', error.message);
    return c.json({ error: 'UNAVAILABLE', message: 'Feedback is not available right now. Please try again.' }, 503);
  }
  if (!session) return c.json({ error: 'SESSION_ENDED', message: 'Feedback for this conversation is no longer available.' }, 409);

  const { data: profile } = await admin.from('profiles').select('learning_pace, nickname').eq('id', userId).single();
  const pace = profile?.learning_pace || 'normal';
  const refs = await loadOralReferences(admin);
  const focusLabel =
    session.focus === 'sec1'
      ? 'a free conversation practising VCE oral Section 1 topics'
      : session.focus === 'sec2'
      ? 'a free conversation practising the VCE oral Section 2 detailed study discussion'
      : 'a free conversation';

  const lines = transcript.map(
    (t) => `${t.speaker === 'student' ? (t.edited ? 'STUDENT (corrected by student)' : 'STUDENT') : 'YAMATO'}: ${t.text}`
  );
  try {
    const feedback = await callGemini(c.env, {
      system: buildMockFeedbackPrompt({
        pace,
        difficulty: 'accelerated',
        sectionsTaken: `${focusLabel}, about ${session.minutes} minutes, with AI Yamato as the conversation partner`,
        criteria: refs.criteria,
        spec: refs.spec,
        report: refs.report,
        advice: refs.advice,
        studentName: clean(profile?.nickname, 30),
        language: body?.feedbackLanguage === 'ja' ? 'ja' : 'en',
        timingSummary: summarizeTiming(transcript),
      }),
      contents: [{ role: 'user', text: `TRANSCRIPT (YAMATO = the AI partner):\n${lines.join('\n')}` }],
      temperature: 0.4,
      maxOutputTokens: 4096,
      thinkingBudget: 1024,
    });
    if (!feedback) throw new Error('empty feedback');
    return c.json({ feedback: normalizeKiku(feedback), pace });
  } catch (err: any) {
    console.error('❌ [oral-superb] feedback AI failed:', err?.message || String(err));
    return c.json({ error: 'AI_FAILED', message: 'Sorry, we could not create your feedback. Please press "Try again".' }, 500);
  }
}

// ---------------------------------------------------------------------------------------------
// 1 分ごとの定期処理: 時間を過ぎても切られていない会話を、サーバー側から切る
// ---------------------------------------------------------------------------------------------
export async function hangupExpiredRealtimeCalls(env: any): Promise<number> {
  const admin = getSupabaseAdmin(env);
  const { data: expired, error } = await admin
    .from('oral_realtime_sessions')
    .select('id, call_id')
    .is('ended_at', null)
    .lt('ends_at', new Date().toISOString())
    .limit(50);
  if (error) throw new Error(error.message);
  for (const s of expired || []) {
    if (s.call_id) await hangup(env, s.call_id);
    await admin.from('oral_realtime_sessions').update({ ended_at: new Date().toISOString() }).eq('id', s.id);
  }
  if ((expired || []).length > 0) console.log(`⏱️ [oral-superb] hung up ${(expired || []).length} expired call(s)`);
  return (expired || []).length;
}
