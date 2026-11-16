/**
 * @file japanese-style.ts
 * @description サイト全体の日本語の表記ルール（AI の指示に入れる文と、AI の返事の後処理）
 *
 * ルール: 動詞の「きく」は、いつも「聞く」と書く（「聴く」は使わない）。
 * - 指示（JAPANESE_STYLE_RULES）だけでは AI がまれに守らないので、返事を normalizeKiku でも直す
 * - 直すのは「聴」のすぐ後にひらがなの送り仮名が続く動詞の形だけ（聴きます・聴いて・聴かない・聴こう・聴けば など）。
 *   「聴解」「視聴」「聴衆」「聴覚」のような熟語はそのまま残す
 */

export const JAPANESE_STYLE_RULES =
  'Japanese Wording Rule: Always write the verb "kiku" (to listen / to hear / to ask) with the kanji 聞 (聞きます, 聞いて, 聞く). Never use 聴 for this verb (never write 聴きます, 聴いて, 聴く).';

export function normalizeKiku(text: string): string {
  if (!text) return text;
  return text.replace(/聴(?=[かきくけこいっ])/g, "聞");
}
