/**
 * @file oral-followup.ts
 * @description elaborate の「つっこみ質問」（試験官のフォローアップ質問）
 *
 * 流れ:
 *   1. 3 問に 1 回、AI がフィードバックと一緒に「FOLLOW_UP: 〜」の行でつっこみ質問を 1 つ作る
 *   2. サーバーが、つっこみが生徒の答えの言葉を使っているか確かめる（使っていなければ決まった質問に置き換える）
 *   3. つっこみを oral_followups テーブルに記録し、その id を「1 回だけ使える無料の券」として画面に返す
 *   4. 生徒がつっこみに答えるとき、画面は券を送る。サーバーは券を使用済みにできたときだけクレジットを引かない
 *      （券は本人のものだけ・30 分以内・1 回だけ。画面を書き換えても、ほかの答えを無料にはできない）
 * テーブル: yamato-portal/supabase/sql/36_oral_followups.sql
 */
import { getSupabaseAdmin } from "./supabase-admin";

/** つっこみがうまく作れなかったときに使う、決まった質問 */
export const FALLBACK_FOLLOW_UP = "そうですか。もう少しくわしく教えてください。";

/** 券の有効時間（分） */
const TOKEN_TTL_MINUTES = 30;

/** 生徒の答えの「中身の言葉」とみなさない、よく出る漢字 */
const STOP_WORDS = new Set(["私", "何", "人", "時", "今", "日", "方", "事", "物", "分", "本当", "思"]);

/**
 * AI の返事から「FOLLOW_UP: 〜」の行を取り出し、その行を除いた返事と一緒に返す
 */
export function extractFollowUp(reply: string): { reply: string; followUp: string | null } {
  const match = reply.match(/^[ \t]*\**FOLLOW_UP\**[ \t]*[:：][ \t]*(.+)$/m);
  if (!match) return { reply, followUp: null };
  const cleanedReply = reply.replace(match[0], "").replace(/\n{3,}/g, "\n\n").trim();
  return { reply: cleanedReply, followUp: match[1].trim() };
}

/** 生徒の答えから、つっこみに使われていてほしい言葉（漢字のまとまり・カタカナ語）を取り出す */
function contentWords(text: string): string[] {
  const words = text.match(/[一-龯々]+|[ァ-ヴー]{2,}/g) || [];
  return words.filter((w) => !STOP_WORDS.has(w));
}

/**
 * つっこみ質問を確かめて、使える形にする。だめなら決まった質問を返す
 * - 日本語の短い 1 文（80 字まで）で、質問の形（？ か「か。」で終わる、または「教えてください」）
 * - 生徒の答えにある言葉を 1 つ以上使っている（＝生徒の話に関係している）
 */
export function validateFollowUp(candidate: string | null, studentAnswer: string): string {
  if (!candidate) return FALLBACK_FOLLOW_UP;
  const q = candidate
    .replace(/<[^>]*>/g, "")
    .replace(/^[「『"']+|[」』"']+$/g, "")
    .trim();
  if (!q || q.length > 80) return FALLBACK_FOLLOW_UP;
  if (!/[ぁ-んァ-ヴ一-龯]/.test(q)) return FALLBACK_FOLLOW_UP;
  if (/[A-Za-z]{3,}/.test(q)) return FALLBACK_FOLLOW_UP;
  const looksLikeQuestion = /[？?]$|か。?$|ください。?$/.test(q);
  if (!looksLikeQuestion) return FALLBACK_FOLLOW_UP;
  const words = contentWords(studentAnswer);
  if (words.length > 0 && !words.some((w) => q.includes(w))) return FALLBACK_FOLLOW_UP;
  return q;
}

/** つっこみを記録して、無料の券（id）を返す。記録できなければ null（つっこみは出さない） */
export async function createFollowUpToken(env: any, userId: string, question: string): Promise<string | null> {
  try {
    const admin = getSupabaseAdmin(env);
    const { data, error } = await admin
      .from("oral_followups")
      .insert({ user_id: userId, question })
      .select("id")
      .single();
    if (error || !data) {
      console.error("❌ [oral-followup] insert failed:", error?.message);
      return null;
    }
    return String(data.id);
  } catch (e: any) {
    console.error("❌ [oral-followup] insert exception:", e?.message || String(e));
    return null;
  }
}

/**
 * 券を使う。本人の券で、30 分以内で、まだ使っていなければ使用済みにして、つっこみの質問を返す。だめなら null
 * （使用済みにする更新と確認を 1 回で行うので、同じ券を 2 回使うことはできない）
 */
export async function redeemFollowUpToken(env: any, userId: string, token: unknown): Promise<string | null> {
  if (typeof token !== "string" || !/^[0-9a-f-]{36}$/i.test(token)) return null;
  try {
    const admin = getSupabaseAdmin(env);
    const since = new Date(Date.now() - TOKEN_TTL_MINUTES * 60 * 1000).toISOString();
    const { data, error } = await admin
      .from("oral_followups")
      .update({ used_at: new Date().toISOString() })
      .eq("id", token)
      .eq("user_id", userId)
      .is("used_at", null)
      .gt("created_at", since)
      .select("question")
      .maybeSingle();
    if (error || !data) return null;
    return String(data.question);
  } catch (e: any) {
    console.error("❌ [oral-followup] redeem exception:", e?.message || String(e));
    return null;
  }
}
