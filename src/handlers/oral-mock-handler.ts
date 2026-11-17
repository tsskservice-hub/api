/**
 * @file src/handlers/oral-mock-handler.ts
 * @description EOY Oral Mock（模擬試験）。フィードバックは試験の途中では出さず、終わったあとにまとめて 1 回。
 *
 *   POST /api/oral-mock/start     { examSection, difficulty, includeBeforeAfter }
 *        → クレジットを 1 回だけ引いて（Section 1: 15 / Section 2: 15 / 通し: 25）、試験の ID を返す
 *   POST /api/oral-mock/turn      { sessionId, stage, mode, history, studentText, ideas, isLastStage }
 *        → 試験官の次のひとこと（文字＋音声）。速さ優先（考える時間なし・短い返事・音声もここで作って 1 回で返す）
 *   POST /api/oral-mock/support-image { sessionId, imageBase64, mimeType }
 *        → Section 2 の写真（特別研究の資料・1 枚）を AI が見て説明を書き、試験の行に入れる（写真そのものは保存しない）
 *   POST /api/oral-mock/feedback  { sessionId, transcript, durations }
 *        → 生徒の learning pace に合わせたフィードバック（会話に特化）。VCE の口頭試験の評価基準（Supabase）にもとづく
 *
 * どれもログインが必要（index.ts の requireAuth）。試験の ID が本人のものか・時間内か・回数内かは SQL 39 の関数が確かめる。
 * 生徒の答え（会話の中身）は保存しない。
 */
import type { Context } from 'hono';
import { getSupabaseAdmin } from '../services/supabase-admin';
import { reserveCredits, refundCredits } from './credit-handler';
import { callGemini } from '../services/gemini';
import { normalizeKiku } from '../utils/japanese-style';
import {
  buildExaminerPrompt,
  buildMockFeedbackPrompt,
  SUPPORT_PHOTO_PROMPT,
  type MockDifficulty,
  type MockStage,
  type MockTurnMode,
} from '../prompts/eoy-oral-mock-exam';

const SECTIONS = ['section1', 'section2', 'both'] as const;
const DIFFICULTIES = ['steady', 'normal', 'accelerated'] as const;
const APP_TYPE: Record<(typeof SECTIONS)[number], string> = {
  section1: 'eoy-oral-mock-section1',
  section2: 'eoy-oral-mock-section2',
  both: 'eoy-oral-mock-full',
};

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

/** 試験官の声（OpenAI TTS）。失敗したら null（ブラウザの読み上げで代わりに読む） */
async function speak(env: any, text: string): Promise<string | null> {
  const key = env.OPENAI_API_KEY;
  if (!key || !text) return null;
  try {
    const res = await fetch('https://api.' + ['open', 'ai'].join('') + '.com/v1/audio/speech', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'tts-1', input: text, voice: 'fable', speed: 1.0, response_format: 'mp3' }),
      // 返事を速くするため、声が 8 秒で作れなければブラウザの読み上げで代わりに読む
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`TTS ${res.status}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    let binary = '';
    for (let i = 0; i < buf.length; i += 0x8000) {
      binary += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    }
    return btoa(binary);
  } catch (err: any) {
    console.error('❌ [oral-mock] TTS failed:', err?.message || String(err));
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// start
// ---------------------------------------------------------------------------------------------
export async function handleOralMockStart(c: Context) {
  const userId = c.get('userId') as string;
  const body = await readJson(c);
  const examSection = SECTIONS.includes(body?.examSection) ? body.examSection : null;
  const difficulty = DIFFICULTIES.includes(body?.difficulty) ? body.difficulty : 'normal';
  if (!examSection) return c.json({ error: 'BAD_REQUEST', message: 'Please choose a section.' }, 400);

  // 💳 試験 1 回分のクレジットを先に引く（足りなければ 402）
  const reservation = await reserveCredits(c, { appType: APP_TYPE[examSection as keyof typeof APP_TYPE] }, userId);
  if (!reservation.ok) return reservation.errorResponse!;

  const admin = getSupabaseAdmin(c.env);
  const { data, error } = await admin
    .from('oral_mock_sessions')
    .insert({
      user_id: userId,
      exam_section: examSection,
      difficulty,
      include_before_after: Boolean(body?.includeBeforeAfter),
      credits_used: reservation.amount,
    })
    .select('id')
    .single();

  if (error || !data) {
    console.error('❌ [oral-mock] session insert failed:', error?.message);
    await refundCredits(c.env, reservation);
    return c.json({ error: 'UNAVAILABLE', message: 'We could not start the mock exam. Your credits were not used. Please try again.' }, 503);
  }

  // 残高（ヘッダーの表示を新しくするため）
  const { data: profile } = await admin.from('profiles').select('credits').eq('id', userId).single();
  return c.json({ sessionId: data.id, creditsUsed: reservation.amount, balance: profile?.credits ?? null });
}

// ---------------------------------------------------------------------------------------------
// turn（試験官の次のひとこと）
// ---------------------------------------------------------------------------------------------
const FALLBACK_LINES: Record<MockStage, Record<MockTurnMode, string>> = {
  sec1: {
    open: 'では、会話を始めましょう。週末はたいてい何をしますか。',
    reply: 'そうですか。もう少しくわしく教えてください。',
    close: 'ありがとうございました。これでセクション1を終わります。',
  },
  sec2: {
    open: 'では、セクション2を始めます。サブトピックは何ですか。',
    reply: 'なるほど。それについて、もう少し説明してください。',
    close: 'ありがとうございました。これでセクション2を終わります。',
  },
};

/**
 * セクションを締めることば（プログラムで決める。AI にまかせると、質問をしてしまうことがあるため）
 * ・これで模擬試験が終わる（退室のやりとりなし）→ 先生と練習したときのように「では、これで終わりましょう。…」
 * ・まだ次のセクションか、退室のやりとりがある → 「ありがとうございました。これでセクション1を終わります。」
 */
function closingWords(stage: MockStage, body: any): string {
  if (body?.endsExam === true) return 'では、これで終わりましょう。今日はありがとうございました。';
  return `ありがとうございました。これで${stage === 'sec1' ? 'セクション1' : 'セクション2'}を終わります。`;
}

export async function handleOralMockTurn(c: Context) {
  const started = Date.now();
  const userId = c.get('userId') as string;
  const body = await readJson(c);

  const sessionId = clean(body?.sessionId, 64);
  const stage: MockStage = body?.stage === 'sec2' ? 'sec2' : 'sec1';
  const mode: MockTurnMode = ['open', 'reply', 'close'].includes(body?.mode) ? body.mode : 'reply';
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return c.json({ error: 'BAD_REQUEST', message: 'Invalid exam.' }, 400);

  const admin = getSupabaseAdmin(c.env);
  const { data: session, error } = await admin.rpc('use_oral_mock_turn', { p_session_id: sessionId, p_user_id: userId });
  if (error) {
    console.error('❌ [oral-mock] use_oral_mock_turn failed:', error.message);
    return c.json({ error: 'UNAVAILABLE', message: 'The examiner is not available right now. Please try again.' }, 503);
  }
  if (!session) {
    return c.json({ error: 'SESSION_ENDED', message: 'This mock exam has ended (time limit reached or already finished). Please start a new one.' }, 409);
  }
  const difficulty = (DIFFICULTIES.includes(session.difficulty) ? session.difficulty : 'normal') as MockDifficulty;

  // このセクションの会話（新しいほうから 16 回分まで）
  const history: { role: 'user' | 'model'; text: string }[] = (Array.isArray(body?.history) ? body.history : [])
    .slice(-16)
    .map((h: any) => ({
      role: h?.speaker === 'student' ? ('user' as const) : ('model' as const),
      text: clean(h?.text, 400),
    }))
    .filter((h: { text: string }) => h.text);
  const studentText = clean(body?.studentText, 600);
  const ideas: string[] = (Array.isArray(body?.ideas) ? body.ideas : [])
    .slice(0, 15)
    .map((q: unknown) => clean(q, 120))
    .filter(Boolean);

  // Gemini には「生徒 → 試験官」の順の会話として渡す（最初は生徒の発言から始める決まりがあるため）
  const contents: { role: 'user' | 'model'; text: string }[] = [];
  for (const h of history) {
    const last = contents[contents.length - 1];
    if (last && last.role === h.role) last.text += '\n' + h.text;
    else contents.push({ ...h });
  }
  if (studentText) {
    const last = contents[contents.length - 1];
    if (last && last.role === 'user') last.text += '\n' + studentText;
    else contents.push({ role: 'user', text: studentText });
  }
  if (contents.length === 0 || contents[0].role !== 'user') contents.unshift({ role: 'user', text: '（試験の部屋に入りました）' });
  if (contents[contents.length - 1].role !== 'user') contents.push({ role: 'user', text: '（生徒は試験官の次のことばを待っています）' });

  let text = '';
  try {
    text = await callGemini(c.env, {
      system: buildExaminerPrompt({
        stage,
        mode,
        difficulty,
        ideas,
        isLastStage: Boolean(body?.isLastStage),
        supportDescription: session.support_description,
        topic: clean(body?.topic, 60) || undefined,
        switchTopic: body?.switchTopic === true,
      }),
      contents,
      temperature: 0.7,
      maxOutputTokens: 200,
      thinkingBudget: 0,
      // 12 秒で返事がなければ、用意した言葉で試験を続ける（止まったままにしない）
      timeoutMs: 12000,
    });
    // 名前やかぎかっこ、改行を取って、話すことばだけにする
    text = normalizeKiku(text)
      .replace(/^[^「」\n]{0,12}[:：]\s*/, '')
      .replace(/[「」"]/g, '')
      .replace(/\s*\n+\s*/g, '')
      .trim()
      .slice(0, 140);
  } catch (err: any) {
    console.error('❌ [oral-mock] examiner AI failed:', err?.message || String(err));
  }
  if (mode === 'close') {
    // 時間切れの締め: 質問はさせない。AI の短い反応（質問・あいさつの文は消す）＋ 決まった締めのことば
    const reaction = text
      .split(/(?<=[。！？!?])/)
      .map((t) => t.trim())
      .filter((t) => t && !/(か[。．]?|[？?])$/.test(t) && !/ありがとう|さようなら|終わ/.test(t))
      .slice(0, 1)
      .join('');
    text = (/[぀-ヿ一-鿿]/.test(reaction) ? reaction : 'そうですか。') + closingWords(stage, body);
  } else if (!text || !/[぀-ヿ一-鿿]/.test(text)) {
    // AI がうまく答えなかったときも、試験は止めない
    text = mode === 'reply' && ideas.length > 0 ? `そうですか。${ideas[Math.floor(Math.random() * ideas.length)]}` : FALLBACK_LINES[stage][mode];
  }

  const audioBase64 = await speak(c.env, text);
  console.log(`🎙️ [oral-mock] turn ${session.turns_used} (${stage}/${mode}) in ${Date.now() - started} ms`);
  return c.json({ text, audioBase64 });
}

// ---------------------------------------------------------------------------------------------
// feedback（試験が終わったあと、まとめて 1 回）
// ---------------------------------------------------------------------------------------------
const STAGE_LABEL: Record<string, string> = {
  before: 'Before Section 1 (entering the room)',
  sec1: 'Section 1 — General Conversation',
  sec2: 'Section 2 — Detailed Study Discussion',
  after: 'After Section 2 (leaving the room)',
};

export async function handleOralMockFeedback(c: Context) {
  const userId = c.get('userId') as string;
  const body = await readJson(c);
  const sessionId = clean(body?.sessionId, 64);
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return c.json({ error: 'BAD_REQUEST', message: 'Invalid exam.' }, 400);

  const transcript: { stage: string; speaker: string; text: string }[] = (Array.isArray(body?.transcript) ? body.transcript : [])
    .slice(0, 200)
    .map((t: any) => ({
      stage: STAGE_LABEL[t?.stage] ? t.stage : 'sec1',
      speaker: t?.speaker === 'student' ? 'student' : 'examiner',
      text: clean(t?.text, 600),
    }))
    .filter((t: { text: string }) => t.text);

  if (!transcript.some((t) => t.speaker === 'student')) {
    return c.json({ error: 'NO_ANSWERS', message: 'There are no answers to give feedback on.' }, 400);
  }

  const admin = getSupabaseAdmin(c.env);
  const { data: session, error } = await admin.rpc('use_oral_mock_feedback', { p_session_id: sessionId, p_user_id: userId });
  if (error) {
    console.error('❌ [oral-mock] use_oral_mock_feedback failed:', error.message);
    return c.json({ error: 'UNAVAILABLE', message: 'Feedback is not available right now. Please try again.' }, 503);
  }
  if (!session) {
    return c.json({ error: 'SESSION_ENDED', message: 'Feedback for this mock exam is no longer available.' }, 409);
  }

  // フィードバックの形は、生徒の learning pace（アカウントの設定）に合わせる
  const { data: profile } = await admin.from('profiles').select('learning_pace').eq('id', userId).single();
  const pace = profile?.learning_pace || 'normal';
  const sectionsTaken =
    session.exam_section === 'both' ? 'Section 1 and Section 2' : session.exam_section === 'section1' ? 'Section 1 only' : 'Section 2 only';

  // 会話をセクションごとに読みやすく並べる
  let current = '';
  const lines: string[] = [];
  for (const t of transcript) {
    if (t.stage !== current) {
      current = t.stage;
      lines.push(`\n=== ${STAGE_LABEL[t.stage]} ===`);
    }
    lines.push(`${t.speaker === 'student' ? 'STUDENT' : 'EXAMINER'}: ${t.text}`);
  }
  const d = body?.durations || {};
  const durationLine = ['sec1', 'sec2']
    .filter((k) => typeof d[k] === 'number')
    .map((k) => `${STAGE_LABEL[k]}: ${Math.round(d[k] / 60)} min`)
    .join(' / ');

  // VCE の口頭試験の評価基準など（Supabase kl_app）。キーの名前が違っていても読めるように、候補を全部見る
  const refs = await loadOralReferences(admin);
  if (!refs.criteria) console.warn('⚠️ [oral-mock] VCE oral criteria not found in kl_app (feedback uses general criteria)');

  try {
    const feedback = await callGemini(c.env, {
      system: buildMockFeedbackPrompt({
        pace,
        difficulty: session.difficulty,
        sectionsTaken,
        criteria: refs.criteria,
        spec: refs.spec,
        report: refs.report,
        advice: refs.advice,
        supportDescription: session.support_description,
      }),
      contents: [{ role: 'user', text: `${durationLine ? `Time spent: ${durationLine}\n` : ''}TRANSCRIPT:${lines.join('\n')}` }],
      temperature: 0.4,
      maxOutputTokens: 4096,
      thinkingBudget: 1024,
    });
    if (!feedback) throw new Error('empty feedback');
    return c.json({ feedback: normalizeKiku(feedback), pace, usedCriteria: Boolean(refs.criteria) });
  } catch (err: any) {
    console.error('❌ [oral-mock] feedback AI failed:', err?.message || String(err));
    return c.json({ error: 'AI_FAILED', message: 'Sorry, we could not create your feedback. Please press "Try again".' }, 500);
  }
}

// ---------------------------------------------------------------------------------------------
// VCE の口頭試験の資料（評価基準・仕様・試験官レポート・アドバイス）を Supabase kl_app から読む
// ---------------------------------------------------------------------------------------------
const REFERENCE_KEYS = {
  criteria: ['VCE_EOY_ORAL_CRITERIA', 'VCE_ORAL_CRITERIA', 'vce-oral-criteria'],
  spec: ['VCE_EOY_ORAL_SPEC', 'vce-eoy-oral-spec'],
  report: ['VCE_EOY_ORAL_REPORT2025', 'vce-eoy-oral-report2025'],
  advice: ['VCE_EOY_ORAL_ADVICE2026', 'vce-eoy-oral-advice2026'],
} as const;

export async function loadOralReferences(admin: any): Promise<Record<keyof typeof REFERENCE_KEYS, unknown>> {
  const allKeys: string[] = Object.values(REFERENCE_KEYS).flat();
  const out: Record<string, unknown> = { criteria: null, spec: null, report: null, advice: null };
  try {
    const { data, error } = await admin.from('kl_app').select('key, data').in('key', allKeys);
    if (error) throw error;
    const byKey = new Map<string, unknown>((data || []).map((r: any) => [r.key, r.data]));
    for (const [name, keys] of Object.entries(REFERENCE_KEYS)) {
      for (const k of keys) {
        const v = byKey.get(k);
        if (v && (typeof v !== 'object' || Object.keys(v as object).length > 0)) {
          out[name] = typeof v === 'string' ? safeParse(v) : v;
          break;
        }
      }
    }
  } catch (err: any) {
    console.error('❌ [oral-mock] loading oral references failed:', err?.message || String(err));
  }
  return out as Record<keyof typeof REFERENCE_KEYS, unknown>;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// ---------------------------------------------------------------------------------------------
// support-image（Section 2 の写真を AI が見て、試験官のための説明を書く）
// ---------------------------------------------------------------------------------------------
const MAX_IMAGE_BASE64 = 2_000_000; // 約 1.5 MB（ブラウザで 1024px 以下に小さくしてから送る）

export async function handleOralMockSupportImage(c: Context) {
  const userId = c.get('userId') as string;
  const body = await readJson(c);
  const sessionId = clean(body?.sessionId, 64);
  const imageBase64 = typeof body?.imageBase64 === 'string' ? body.imageBase64.replace(/^data:[^,]+,/, '') : '';
  const mimeType = ['image/jpeg', 'image/png', 'image/webp'].includes(body?.mimeType) ? body.mimeType : 'image/jpeg';
  if (!/^[0-9a-f-]{36}$/i.test(sessionId) || !imageBase64) {
    return c.json({ error: 'BAD_REQUEST', message: 'Invalid request.' }, 400);
  }
  if (imageBase64.length > MAX_IMAGE_BASE64) {
    return c.json({ error: 'TOO_LARGE', message: 'The photo is too large.' }, 413);
  }

  const admin = getSupabaseAdmin(c.env);
  // 本人の、Section 2 がある、始めて 60 分以内の、まだ写真の説明がない試験だけ
  const { data: session } = await admin
    .from('oral_mock_sessions')
    .select('id, exam_section, support_description, created_at, feedback_at')
    .eq('id', sessionId)
    .eq('user_id', userId)
    .single();
  const fresh = session && Date.now() - new Date(session.created_at).getTime() < 60 * 60 * 1000;
  if (!session || !fresh || session.feedback_at || session.exam_section === 'section1') {
    return c.json({ error: 'SESSION_ENDED', message: 'This mock exam cannot use a photo.' }, 409);
  }
  if (session.support_description) {
    return c.json({ ok: true, alreadyDone: true });
  }

  let description = '';
  try {
    description = await callGemini(c.env, {
      system: SUPPORT_PHOTO_PROMPT,
      contents: [{ role: 'user', text: 'Describe this support material photo.', image: { mimeType, base64: imageBase64 } }],
      temperature: 0.2,
      maxOutputTokens: 400,
      thinkingBudget: 0,
    });
  } catch (err: any) {
    console.error('❌ [oral-mock] photo description failed:', err?.message || String(err));
    return c.json({ error: 'AI_FAILED', message: 'The examiner could not look at your photo, so the exam will continue without it.' }, 500);
  }

  if (!description || /^INAPPROPRIATE/i.test(description.trim())) {
    return c.json({ ok: false, error: 'NOT_SUITABLE', message: 'This photo cannot be used in the exam, so the exam will continue without it.' });
  }

  await admin
    .from('oral_mock_sessions')
    .update({ support_description: description.slice(0, 1500) })
    .eq('id', sessionId)
    .eq('user_id', userId);
  return c.json({ ok: true });
}
