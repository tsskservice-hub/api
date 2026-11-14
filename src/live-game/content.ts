/**
 * @file src/live-game/content.ts
 * @description クラスのライブゲームの問題づくり（サーバー専用）
 *
 * 問題のもとは Supabase の kl_character（ひらがな・カタカナ・VCE 漢字）。
 * 正解の番号はサーバーだけが持ち、生徒の端末には「問題文と 4 つの選択肢」だけを送る。
 */

export type QuestionSet = 'hiragana' | 'katakana' | 'kanji';

/** 出題のもとになる 1 文字分 */
export type ContentItem = {
  /** 先生の「間違えた文字」一覧に出す文字 */
  key: string;
  character: string;
  /** かな: Romaji。漢字: 読み方 */
  reading: string;
  /** 漢字だけ: 英語の意味 */
  meaning?: string;
};

/** サーバーが持つ問題（correctIndex は端末に送らない） */
export type Question = {
  qid: string;
  itemKey: string;
  label: string;
  prompt: string;
  /** 問題文が日本語の文字か（端末で大きく表示するため） */
  promptIsJapanese: boolean;
  options: string[];
  optionsAreJapanese: boolean;
  correctIndex: number;
};

/** 端末に送ってよい形 */
export function toPublicQuestion(q: Question) {
  return {
    qid: q.qid,
    label: q.label,
    prompt: q.prompt,
    promptIsJapanese: q.promptIsJapanese,
    options: q.options,
    optionsAreJapanese: q.optionsAreJapanese,
  };
}

const clean = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** kl_character から出題用の文字を読み込む */
export async function loadContent(admin: any, set: QuestionSet): Promise<ContentItem[]> {
  const { data, error } = await admin
    .from('kl_character')
    .select('character, romaji, kun_reading, kun_display, on_display, meaning')
    .eq('char_type', set);
  if (error) throw new Error(`kl_character: ${error.message}`);

  const items: ContentItem[] = [];
  const seen = new Set<string>();
  for (const r of data ?? []) {
    const character = clean(r.character);
    if (!character || seen.has(character)) continue;
    if (set === 'kanji') {
      const reading = clean(r.kun_display) || clean(r.kun_reading) || clean(r.on_display);
      const meaning = clean(r.meaning);
      if (!reading && !meaning) continue;
      items.push({ key: character, character, reading, meaning: meaning || undefined });
    } else {
      const romaji = clean(r.romaji);
      if (!romaji) continue;
      items.push({ key: character, character, reading: romaji });
    }
    seen.add(character);
  }
  return items;
}

function randomInt(n: number) {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] % n;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 正解と重ならない選択肢を 3 つ選ぶ */
function pickDistractors(pool: ContentItem[], target: ContentItem, getText: (i: ContentItem) => string | undefined) {
  const correct = getText(target);
  const used = new Set<string>([correct ?? '']);
  const out: string[] = [];
  for (const item of shuffle(pool)) {
    const text = getText(item);
    if (!text || used.has(text)) continue;
    used.add(text);
    out.push(text);
    if (out.length === 3) break;
  }
  return out;
}

/**
 * 1 問つくる。recent（直前に出した文字）は避ける。
 * ・かな: 「文字 → Romaji」か「Romaji → 文字」
 * ・漢字: 「漢字 → 読み方」か「漢字 → 意味」（両方まぜる）
 */
export function makeQuestion(pool: ContentItem[], set: QuestionSet, recent: string[]): Question | null {
  if (pool.length < 4) return null;
  const candidates = pool.filter((i) => !recent.includes(i.key));
  const target = (candidates.length ? candidates : pool)[randomInt(candidates.length || pool.length)];

  type Kind = 'charToReading' | 'readingToChar' | 'kanjiToReading' | 'kanjiToMeaning';
  let kind: Kind;
  if (set === 'kanji') {
    const kinds: Kind[] = [];
    if (target.reading) kinds.push('kanjiToReading');
    if (target.meaning) kinds.push('kanjiToMeaning');
    kind = kinds[randomInt(kinds.length)];
  } else {
    kind = randomInt(2) === 0 ? 'charToReading' : 'readingToChar';
  }

  let label: string;
  let prompt: string;
  let correct: string;
  let distractors: string[];
  let promptIsJapanese: boolean;
  let optionsAreJapanese: boolean;

  switch (kind) {
    case 'charToReading':
      label = 'Which romaji is this?';
      prompt = target.character;
      correct = target.reading;
      distractors = pickDistractors(pool, target, (i) => i.reading);
      promptIsJapanese = true;
      optionsAreJapanese = false;
      break;
    case 'readingToChar':
      label = `Which ${set === 'hiragana' ? 'hiragana' : 'katakana'} is this?`;
      prompt = target.reading;
      correct = target.character;
      distractors = pickDistractors(pool, target, (i) => i.character);
      promptIsJapanese = false;
      optionsAreJapanese = true;
      break;
    case 'kanjiToReading':
      label = 'How do you read this kanji?';
      prompt = target.character;
      correct = target.reading;
      distractors = pickDistractors(pool, target, (i) => i.reading || undefined);
      promptIsJapanese = true;
      optionsAreJapanese = true;
      break;
    default:
      label = 'What does this kanji mean?';
      prompt = target.character;
      correct = target.meaning ?? '';
      distractors = pickDistractors(pool, target, (i) => i.meaning);
      promptIsJapanese = true;
      optionsAreJapanese = false;
  }

  if (distractors.length < 3) return null;
  const options = shuffle([correct, ...distractors]);
  return {
    qid: crypto.randomUUID(),
    itemKey: target.key,
    label,
    prompt,
    promptIsJapanese,
    options,
    optionsAreJapanese,
    correctIndex: options.indexOf(correct),
  };
}

// ---------- 文化クイズ（ヤマトの問題で、言葉の問題と交互に出す） ----------

/**
 * もとは毎日クイズ（kl_app の DAILY_QUIZZES）。
 * 日本語の知識がなくても答えられるように、topic が CULTURE_TOPICS に当てはまる問題だけを使う
 * （Grammar・Kanji などは使わない）。英語で出すので、日本語がまだ読めない生徒でも答えられる。
 * 当てはまる問題が無ければ、ヤマトの問題は言葉の問題だけになる。
 */
export type CultureQuizItem = { question: string; options: string[]; answerIndex: number };

/** 文化クイズとして使う topic（小文字で、この言葉を含むもの） */
const CULTURE_TOPICS = ['culture'];

export async function loadCultureQuiz(admin: any): Promise<CultureQuizItem[]> {
  const { data, error } = await admin.from('kl_app').select('data').eq('key', 'DAILY_QUIZZES').maybeSingle();
  if (error) throw new Error(`DAILY_QUIZZES: ${error.message}`);
  const raw = data?.data;
  // 毎日クイズのページと同じ読み方（配列そのもの、または { quizzes } / { DAILY_QUIZZES }）
  const list: any[] = Array.isArray(raw) ? raw : raw?.quizzes || raw?.DAILY_QUIZZES || [];
  return list
    .filter((q) => {
      const topic = typeof q?.topic === 'string' ? q.topic.toLowerCase() : '';
      return CULTURE_TOPICS.some((t) => topic.includes(t));
    })
    .map((q) => ({ question: q.question, options: q.options, answerIndex: q.answer }))
    .filter(
      (q) =>
        typeof q.question === 'string' &&
        q.question.trim() &&
        Array.isArray(q.options) &&
        q.options.length >= 2 &&
        q.options.every((o: unknown) => typeof o === 'string' && o.trim()) &&
        new Set(q.options.map((o: string) => o.trim())).size === q.options.length &&
        Number.isInteger(q.answerIndex) &&
        q.answerIndex >= 0 &&
        q.answerIndex < q.options.length
    );
}

export function makeCultureQuestion(item: CultureQuizItem): Question {
  const correct = item.options[item.answerIndex];
  const options = shuffle(item.options.map((o) => o.trim()));
  return {
    qid: crypto.randomUUID(),
    itemKey: `culture: ${item.question.slice(0, 40)}`,
    label: 'Culture quiz',
    prompt: item.question.trim(),
    promptIsJapanese: false,
    options,
    optionsAreJapanese: false,
    correctIndex: options.indexOf(correct.trim()),
  };
}

// ---------- 宝箱 ----------

export type ChestItem = {
  id: string;
  name: string;
  nameJa: string;
  description: string;
};

const CHEST_ITEMS: (ChestItem & { weight: number; apply: (coins: number) => number })[] = [
  {
    id: 'kozuchi',
    name: 'Uchide no Kozuchi',
    nameJa: '打ち出の小づち',
    description: 'Your coins are doubled!',
    weight: 15,
    apply: (c) => c * 2,
  },
  {
    id: 'manekineko',
    name: 'Maneki-neko',
    nameJa: '招き猫',
    description: '+10 coins!',
    weight: 20,
    apply: (c) => c + 10,
  },
  {
    id: 'koban',
    name: 'Koban',
    nameJa: '小判',
    description: '+5 coins!',
    weight: 35,
    apply: (c) => c + 5,
  },
  {
    id: 'daruma',
    name: 'Daruma',
    nameJa: 'だるま',
    description: '+3 coins!',
    weight: 30,
    apply: (c) => c + 3,
  },
  {
    // じゃんけん勝負のカード。金貨はここでは変わらず、相手を選んで勝負する（room.ts）
    id: 'janken',
    name: 'Janken Battle',
    nameJa: 'じゃんけん勝負',
    description: 'Challenge someone to janken! The loser gives half of their coins to the winner.',
    weight: 25,
    apply: (c) => c,
  },
];

/** 何問正解するごとに宝箱が出るか */
export const CORRECT_PER_CHEST = 3;

/**
 * 宝箱の中身はサーバーが開けた瞬間に決める（先に端末へ送らない）
 * janken: じゃんけん勝負のカードを入れるか（先生が「じゃんけんなし」にしたら入れない）
 */
export function openChest(coins: number, options: { janken: boolean }): { item: ChestItem; coins: number } {
  const items = CHEST_ITEMS.filter((i) => options.janken || i.id !== 'janken');
  const total = items.reduce((s, i) => s + i.weight, 0);
  let r = randomInt(total);
  for (const i of items) {
    if (r < i.weight) {
      const { weight: _w, apply, ...item } = i;
      return { item, coins: apply(coins) };
    }
    r -= i.weight;
  }
  const last = items[items.length - 1];
  const { weight: _w, apply, ...item } = last;
  return { item, coins: apply(coins) };
}

// ---------- じゃんけん ----------

export type Hand = 'rock' | 'scissors' | 'paper';
export const HANDS: Hand[] = ['rock', 'scissors', 'paper'];

/** a から見た勝ち負け */
export function judgeJanken(a: Hand, b: Hand): 'win' | 'lose' | 'draw' {
  if (a === b) return 'draw';
  if ((a === 'rock' && b === 'scissors') || (a === 'scissors' && b === 'paper') || (a === 'paper' && b === 'rock')) return 'win';
  return 'lose';
}

export { randomInt, shuffle };
