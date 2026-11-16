/**
 * @file japanese-counters.ts
 * @description 「数字＋数え方」（十一分・三本・六匹・二十日 など）の読みを、決まったルールで出す
 *
 * AI はここをよく間違える（十一分 → ×じゅういちふん ○じゅういっぷん）ので、
 * 漢字AI検索では、言葉が「数字＋数え方」だけのときは AI の読みをこの結果で置きかえる。
 * 対応する数は 1〜99（漢数字）。知らない形のときは null を返す（AI の読みをそのまま使う）。
 */

const DIGIT: Record<number, string> = {
  1: "いち", 2: "に", 3: "さん", 4: "よん", 5: "ご", 6: "ろく", 7: "なな", 8: "はち", 9: "きゅう",
};

interface CounterRule {
  /** 普通の読み（例: 分 → ふん） */
  base: string;
  /** 1 の位がこの数のときの読み（数字＋数え方ぜんぶ。例: 1 → いっぷん）。10 は「じゅう」の部分の読み */
  end?: Partial<Record<number, string>>;
  /** その数ちょうどのときだけの読み（例: 人 1 → ひとり、日 20 → はつか） */
  exact?: Partial<Record<number, string>>;
  /** この範囲の数だけ対応する（例: 月は 1〜12） */
  max?: number;
  /** 1 だけは AI にまかせる（例: 一日 = いちにち／ついたち は文で変わる） */
  skipOne?: boolean;
}

const RULES: Record<string, CounterRule> = {
  分: { base: "ふん", end: { 1: "いっぷん", 3: "さんぷん", 4: "よんぷん", 6: "ろっぷん", 8: "はっぷん", 10: "じゅっぷん" } },
  本: { base: "ほん", end: { 1: "いっぽん", 3: "さんぼん", 6: "ろっぽん", 8: "はっぽん", 10: "じゅっぽん" } },
  匹: { base: "ひき", end: { 1: "いっぴき", 3: "さんびき", 6: "ろっぴき", 8: "はっぴき", 10: "じゅっぴき" } },
  杯: { base: "はい", end: { 1: "いっぱい", 3: "さんばい", 6: "ろっぱい", 8: "はっぱい", 10: "じゅっぱい" } },
  個: { base: "こ", end: { 1: "いっこ", 6: "ろっこ", 8: "はっこ", 10: "じゅっこ" } },
  回: { base: "かい", end: { 1: "いっかい", 6: "ろっかい", 8: "はっかい", 10: "じゅっかい" } },
  階: { base: "かい", end: { 1: "いっかい", 3: "さんがい", 6: "ろっかい", 8: "はっかい", 10: "じゅっかい" } },
  歳: { base: "さい", end: { 1: "いっさい", 8: "はっさい", 10: "じゅっさい" }, exact: { 20: "はたち" } },
  才: { base: "さい", end: { 1: "いっさい", 8: "はっさい", 10: "じゅっさい" }, exact: { 20: "はたち" } },
  冊: { base: "さつ", end: { 1: "いっさつ", 8: "はっさつ", 10: "じゅっさつ" } },
  点: { base: "てん", end: { 1: "いってん", 8: "はってん", 10: "じゅってん" } },
  枚: { base: "まい" },
  円: { base: "えん", end: { 4: "よえん" } },
  年: { base: "ねん", end: { 4: "よねん" } },
  時: { base: "じ", end: { 4: "よじ", 7: "しちじ", 9: "くじ" }, max: 24 },
  時間: { base: "じかん", end: { 4: "よじかん", 9: "くじかん" } },
  週間: { base: "しゅうかん", end: { 1: "いっしゅうかん", 8: "はっしゅうかん", 10: "じゅっしゅうかん" } },
  月: { base: "がつ", end: { 4: "しがつ", 7: "しちがつ", 9: "くがつ" }, max: 12 },
  人: { base: "にん", end: { 4: "よにん" }, exact: { 1: "ひとり", 2: "ふたり" } },
  日: {
    base: "にち",
    end: { 4: "よっか" },
    exact: {
      2: "ふつか", 3: "みっか", 4: "よっか", 5: "いつか", 6: "むいか", 7: "なのか", 8: "ようか",
      9: "ここのか", 10: "とおか", 20: "はつか",
    },
    skipOne: true,
  },
  つ: {
    base: "",
    exact: { 1: "ひとつ", 2: "ふたつ", 3: "みっつ", 4: "よっつ", 5: "いつつ", 6: "むっつ", 7: "ななつ", 8: "やっつ", 9: "ここのつ", 10: "とお" },
    max: 10,
  },
};

// 長い数え方を先に試す（時間 を 時 より先に）
const COUNTERS = Object.keys(RULES).sort((a, b) => b.length - a.length);
const KANJI_DIGIT: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

/** 一〜九十九 の漢数字を数にする（それ以外は null） */
function parseKanjiNumber(s: string): number | null {
  const m = s.match(/^([二三四五六七八九])?(十)?([一二三四五六七八九])?$/);
  if (!m || s === "") return null;
  const [, tensDigit, ten, ones] = m;
  if (tensDigit && !ten) return ones ? null : KANJI_DIGIT[tensDigit]; // 「三」だけ
  const tens = ten ? (tensDigit ? KANJI_DIGIT[tensDigit] : 1) : 0;
  const n = tens * 10 + (ones ? KANJI_DIGIT[ones] : 0);
  return n > 0 ? n : null;
}

/** 数＋数え方の読み（ひらがな） */
function readCounter(n: number, counter: string): string | null {
  const rule = RULES[counter];
  if (!rule) return null;
  if (rule.max && n > rule.max) return null;
  if (rule.skipOne && n === 1) return null;
  if (rule.exact?.[n]) return rule.exact[n]!;
  if (counter === "つ") return null;

  const tens = Math.floor(n / 10);
  const ones = n % 10;
  const tensPrefix = tens > 1 ? DIGIT[tens] : "";
  if (ones === 0) {
    // 10・20・30…: 「じゅう」の部分が変わる（じゅっぷん）
    return tensPrefix + (rule.end?.[10] ?? "じゅう" + rule.base);
  }
  const tensPart = tens > 0 ? tensPrefix + "じゅう" : "";
  return tensPart + (rule.end?.[ones] ?? DIGIT[ones] + rule.base);
}

/**
 * 言葉が「漢数字＋数え方」（＋「間」）だけなら、その読みを返す。それ以外は null。
 * 例: 十一分 → じゅういっぷん、三本 → さんぼん、二十日 → はつか、十分間 → じゅっぷんかん
 */
export function counterReading(word: string): string | null {
  let w = word.trim();
  // 「十分」は「じゅっぷん（10 分）」か「じゅうぶん（足りている）」か、文で変わるので AI にまかせる
  if (w === "十分") return null;
  let suffix = "";
  // 「〜分間」「〜年間」「〜日間」の「間」
  if (/^.+(分|年|日)間$/.test(w)) {
    w = w.slice(0, -1);
    suffix = "かん";
  }
  for (const counter of COUNTERS) {
    if (!w.endsWith(counter)) continue;
    const n = parseKanjiNumber(w.slice(0, -counter.length));
    if (n === null) continue;
    // 「一日間」は いちにちかん
    if (suffix && counter === "日" && n === 1) return "いちにちかん";
    const reading = readCounter(n, counter);
    return reading ? reading + suffix : null;
  }
  return null;
}

// ---- ひらがな → ローマ字（ヘボン式・のばす音はそのまま: じゅう → juu） ----
const ROMAJI: Record<string, string> = {
  あ: "a", い: "i", う: "u", え: "e", お: "o", か: "ka", き: "ki", く: "ku", け: "ke", こ: "ko",
  さ: "sa", し: "shi", す: "su", せ: "se", そ: "so", た: "ta", ち: "chi", つ: "tsu", て: "te", と: "to",
  な: "na", に: "ni", ぬ: "nu", ね: "ne", の: "no", は: "ha", ひ: "hi", ふ: "fu", へ: "he", ほ: "ho",
  ま: "ma", み: "mi", む: "mu", め: "me", も: "mo", や: "ya", ゆ: "yu", よ: "yo",
  ら: "ra", り: "ri", る: "ru", れ: "re", ろ: "ro", わ: "wa", を: "o", ん: "n",
  が: "ga", ぎ: "gi", ぐ: "gu", げ: "ge", ご: "go", ざ: "za", じ: "ji", ず: "zu", ぜ: "ze", ぞ: "zo",
  だ: "da", ぢ: "ji", づ: "zu", で: "de", ど: "do", ば: "ba", び: "bi", ぶ: "bu", べ: "be", ぼ: "bo",
  ぱ: "pa", ぴ: "pi", ぷ: "pu", ぺ: "pe", ぽ: "po",
};
const YOON: Record<string, string> = { ゃ: "a", ゅ: "u", ょ: "o" };

export function hiraganaToRomaji(kana: string): string {
  let out = "";
  let doubleNext = false;
  for (let i = 0; i < kana.length; i++) {
    const ch = kana[i];
    if (ch === "っ") {
      doubleNext = true;
      continue;
    }
    let syl = ROMAJI[ch] ?? ch;
    const next = kana[i + 1];
    if (next && YOON[next]) {
      // きゃ → kya、しゃ → sha、じゃ → ja、ちゃ → cha
      const stem = syl.endsWith("i") ? syl.slice(0, -1) : syl;
      syl = /^(sh|ch|j)$/.test(stem) ? stem + YOON[next] : stem + "y" + YOON[next];
      i++;
    }
    if (doubleNext) {
      syl = (syl.startsWith("ch") ? "t" : syl[0]) + syl;
      doubleNext = false;
    }
    out += syl;
  }
  return out;
}
