/**
 * @file src/handlers/kanji-lookup-handler.ts
 * @description 漢字AI検索（どのページにもある「🔍 Kanji」ボタン）
 *
 * POST /api/kanji-lookup  { query: "優しい", context?: "両親は普段は優しいですが…" }
 *   → { words: [{ word, reading, romaji, meaning }], free, remainingFree, freeLimit, signedIn }
 *
 * 料金（SQL 37 の claim_kanji_lookup が決める）:
 *   ・ログインしている人: 1 日 20 回まで無料、それを超えたら 1 回 1 クレジット
 *   ・ログインしていない人: 1 日 3 回まで無料（IP アドレスを暗号化した値で数える。IP そのものは保存しない）
 *   ・AI が失敗したら、その 1 回は取り消す（無料の回数も、クレジットも戻る）
 * 「VCE の漢字かどうか」は AI に聞かず、ブラウザが VCE の漢字の一覧で判定する（確実なので）。
 */
import type { Context } from 'hono';
import { getSupabaseAdmin, isAiUnlocked } from '../services/supabase-admin';
import { AI_TRIAL_REQUIRED_TEXT } from './credit-handler';
import { getGoogleAccessToken } from '../services/google-auth';
import { SERVER_CREDIT_COSTS } from '../credit-rules';
import { counterReading, hiraganaToRomaji } from '../services/japanese-counters';

const USER_FREE_LIMIT = 20;
const GUEST_FREE_LIMIT = 3;
const MAX_QUERY = 30;
const MAX_CONTEXT = 120;

const KANJI_RE = /[㐀-䶿一-鿿豈-﫿々]/;
const KANA_ONLY_RE = /^[ぁ-ゟ゠-ヿー・\s]+$/;

/** ログインしていればそのユーザー ID（トークンが無い・切れているときは、ログインしていない人として扱う） */
async function getOptionalUserId(c: Context): Promise<string | null> {
  const token = (c.req.header('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  try {
    const { data, error } = await getSupabaseAdmin(c.env).auth.getUser(token);
    if (error || !data?.user) return null;
    return data.user.id;
  } catch {
    return null;
  }
}

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function cleanText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/<[^>]*>/g, '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, max);
}

const SYSTEM_PROMPT = `You are a Japanese reading dictionary for English-speaking high-school students learning Japanese.
The user gives a Japanese QUERY (a word or a short phrase) and sometimes the CONTEXT sentence it came from.
Split the QUERY into the words that contain kanji (ignore words with no kanji, max 8 words).
For each word give:
- "word": the word exactly as it appears in the QUERY (include okurigana that belongs to it, e.g. 優しい, 飼って)
- "reading": the reading in hiragana for THIS context (e.g. 今日 = きょう, 上手 = じょうず). Hiragana only.
- "romaji": Hepburn romaji of the reading
- "meaning": a short English meaning (max 8 words) for this context
Numbers with counters change their sound. Apply these rules carefully:
- 十分 is じゅっぷん (ten minutes) or じゅうぶん (enough) — decide from the CONTEXT
- 一分 いっぷん, 三分 さんぷん, 四分 よんぷん, 六分 ろっぷん, 八分 はっぷん, 十分 じゅっぷん, 十一分 じゅういっぷん, 二十分 にじゅっぷん
- 一本 いっぽん, 三本 さんぼん, 六本 ろっぽん; 一匹 いっぴき, 三匹 さんびき; 一杯 いっぱい, 三杯 さんばい
- 一回 いっかい, 一個 いっこ, 一冊 いっさつ, 一歳 いっさい, 二十歳 はたち, 一人 ひとり, 二人 ふたり, 四人 よにん
- 四時 よじ, 七時 しちじ, 九時 くじ, 四月 しがつ, 七月 しちがつ, 九月 くがつ
- 二日 ふつか, 三日 みっか, 四日 よっか, 五日 いつか, 六日 むいか, 七日 なのか, 八日 ようか, 九日 ここのか, 十日 とおか, 十四日 じゅうよっか, 二十日 はつか
Return JSON only.`;

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    words: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          word: { type: 'STRING' },
          reading: { type: 'STRING' },
          romaji: { type: 'STRING' },
          meaning: { type: 'STRING' },
        },
        required: ['word', 'reading', 'romaji', 'meaning'],
      },
    },
  },
  required: ['words'],
};

export async function handleKanjiLookup(c: Context) {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'BAD_REQUEST', message: 'Invalid request.' }, 400);
  }

  const query = cleanText(body?.query, MAX_QUERY);
  const context = cleanText(body?.context, MAX_CONTEXT);
  // 漢字が無いものは調べない（回数にも数えない）
  if (!query || !KANJI_RE.test(query)) {
    return c.json({ error: 'NO_KANJI', message: 'Please enter a word that has kanji in it.' }, 400);
  }

  const userId = await getOptionalUserId(c);
  const ip = c.req.header('CF-Connecting-IP') || '';
  if (!userId && !ip) {
    return c.json({ error: 'LOGIN_REQUIRED', message: 'Please sign in to use the kanji lookup.' }, 401);
  }
  const ipHash = userId ? null : await sha256Hex(`kanji-lookup:${ip}`);

  const admin = getSupabaseAdmin(c.env);

  // 1 回分を使う（無料か、1 クレジットか）
  const { data: claim, error: claimError } = await admin.rpc('claim_kanji_lookup', {
    p_user_id: userId,
    p_ip_hash: ipHash,
    p_user_free_limit: USER_FREE_LIMIT,
    p_guest_free_limit: GUEST_FREE_LIMIT,
    p_cost: SERVER_CREDIT_COSTS.kanjiLookup,
  });
  if (claimError || !claim) {
    console.error('❌ [kanji-lookup] claim failed:', claimError?.message);
    return c.json({ error: 'UNAVAILABLE', message: 'The kanji lookup is not available right now. Please try again later.' }, 503);
  }
  if (!claim.ok) {
    if (claim.reason === 'GUEST_LIMIT') {
      return c.json({
        error: 'GUEST_LIMIT',
        message: `You've used today's ${GUEST_FREE_LIMIT} free lookups. Sign in to get ${USER_FREE_LIMIT} free lookups a day.`,
        signedIn: false,
        remainingFree: 0,
        freeLimit: GUEST_FREE_LIMIT,
      }, 429);
    }
    // AI 体験・プランの購入前の人には、買い方を案内する（SQL 51）
    if (userId && !(await isAiUnlocked(admin, userId))) {
      return c.json({
        error: 'AI_TRIAL_REQUIRED',
        message: `You've used today's ${USER_FREE_LIMIT} free lookups. ${AI_TRIAL_REQUIRED_TEXT}`,
        signedIn: true,
        remainingFree: 0,
        freeLimit: USER_FREE_LIMIT,
      }, 402);
    }
    return c.json({
      error: 'NO_CREDITS',
      message: `You've used today's ${USER_FREE_LIMIT} free lookups. After that, each lookup uses ${SERVER_CREDIT_COSTS.kanjiLookup} credit(s), and you don't have enough credits.`,
      signedIn: true,
      remainingFree: 0,
      freeLimit: USER_FREE_LIMIT,
    }, 402);
  }

  const release = async () => {
    try {
      await admin.rpc('release_kanji_lookup', { p_id: claim.id });
    } catch (err: any) {
      console.error('❌ [kanji-lookup] release failed:', err?.message || String(err));
    }
  };

  try {
    const serviceAccountKey = c.env.VERTEX_AI_KEY || c.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    const projectId = c.env.VERTEX_AI_PROJECT_ID;
    const region = c.env.VERTEX_AI_REGION || 'us-central1';
    if (!serviceAccountKey || !projectId) throw new Error('Vertex AI is not configured');

    const accessToken = await getGoogleAccessToken(serviceAccountKey);
    const vertexUrl =
      'https://' + region + '-aiplatform.' + ['google', 'apis'].join('') + '.com/v1/projects/' + projectId +
      '/locations/' + region + '/publishers/google/models/gemini-2.5-flash:generateContent';

    const userText = context ? `QUERY: ${query}\nCONTEXT: ${context}` : `QUERY: ${query}`;
    const res = await fetch(vertexUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + accessToken },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: userText }] }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 600,
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
          // 考える時間は要らない（速く・安く）
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    });
    if (!res.ok) throw new Error(`Vertex ${res.status}: ${(await res.text()).slice(0, 300)}`);

    const data = (await res.json()) as any;
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const parsed = JSON.parse(raw);

    // 答えを確かめる: 言葉が質問の中にあり、漢字を含み、読みがかなだけのものだけ残す
    const words = (Array.isArray(parsed?.words) ? parsed.words : [])
      .map((w: any) => ({
        word: cleanText(w?.word, MAX_QUERY),
        reading: cleanText(w?.reading, 40),
        romaji: cleanText(w?.romaji, 60),
        meaning: cleanText(w?.meaning, 80),
      }))
      .filter((w: any) => w.word && query.includes(w.word) && KANJI_RE.test(w.word) && KANA_ONLY_RE.test(w.reading))
      // 「数字＋数え方」（十一分・三本・二十日 など）は、AI ではなく決まったルールで読みを出す（AI がよく間違えるため）
      .map((w: any) => {
        const fixed = counterReading(w.word);
        return fixed ? { ...w, reading: fixed, romaji: hiraganaToRomaji(fixed) } : w;
      })
      .slice(0, 8);

    if (words.length === 0) throw new Error('No valid words in AI response');

    return c.json({
      words,
      free: Boolean(claim.free),
      remainingFree: Number(claim.remaining_free ?? 0),
      freeLimit: Number(claim.free_limit ?? (userId ? USER_FREE_LIMIT : GUEST_FREE_LIMIT)),
      signedIn: Boolean(userId),
      ...(claim.free ? {} : { balance: Number(claim.balance ?? 0) }),
    });
  } catch (err: any) {
    console.error('❌ [kanji-lookup] AI failed:', err?.message || String(err));
    await release();
    return c.json({ error: 'AI_FAILED', message: "Sorry, we couldn't look that up. Please try again. (This try was not counted.)" }, 500);
  }
}
