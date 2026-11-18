/**
 * @file credit-expiry.ts
 * @description 期限が来たクレジット（毎日クイズ 7 日・パック 1 年など）を片づける。1 時間ごとの定期処理から呼ぶ
 *
 * 中身はデータベース関数 expire_credit_lots（yamato-portal/supabase/sql/49_credit_lots.sql）。
 * 期限切れのロットを 0 にし、残高を減らし、履歴に「Credits expired」を残す。
 * SQL 49 をまだ実行していないときは、関数がないのでエラーを記録するだけ（ほかの処理には影響しない）。
 */
import { getSupabaseAdmin } from './supabase-admin';

export async function expireCreditLots(env: unknown): Promise<number> {
  const admin = getSupabaseAdmin(env);
  const { data, error } = await admin.rpc('expire_credit_lots');
  if (error) throw new Error(error.message);
  const users = Number(data ?? 0);
  if (users > 0) console.log(`[credit-expiry] expired credits for ${users} user(s).`);
  return users;
}

/**
 * 年払いのサブスクの、2 か月目以降の毎月のクレジットを渡す（1 時間ごと）。
 * 中身はデータベース関数 grant_due_annual_credits（51_subscriptions.sql）。同じ月の分は 2 回渡さない。
 */
export async function grantDueAnnualCredits(env: unknown): Promise<number> {
  const admin = getSupabaseAdmin(env);
  const { data, error } = await admin.rpc('grant_due_annual_credits');
  if (error) throw new Error(error.message);
  const granted = Number(data ?? 0);
  if (granted > 0) console.log(`[credit-expiry] granted ${granted} monthly credit batch(es) to annual subscribers.`);
  return granted;
}
