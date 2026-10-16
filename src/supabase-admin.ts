/**
 * @file supabase-admin.ts
 * @description Cloudflare Workers / API環境用の Supabase 管理者クライアントおよびクレジット処理ヘルパー
 */

import { createClient } from "@supabase/supabase-js";
import { getRequiredCredits, FeatureKey } from "./credit-rules.js";

/**
 * サーバーサイド用 Supabase 管理者クライアントを初期化する関数
 * @param env Cloudflareの環境変数オブジェクト (context.env)
 */
export function getSupabaseAdmin(env: any) {
  const supabaseUrl = env?.SUPABASE_URL || env?.VITE_SUPABASE_URL;
  // バックエンド専用の特権キー (Service Role Key) を使用します
  const supabaseServiceKey = env?.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error("Supabase URL または SUPABASE_SERVICE_ROLE_KEY が環境変数に設定されていません。");
  }

  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

/**
 * 1. サーバー側でユーザーの最新クレジット残高をデータベースから直接取得する関数
 */
export async function fetchUserCredits(supabaseAdmin: any, userId: string): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("credits")
    .eq("id", userId)
    .single();

  if (error || !data) {
    console.error("❌ [supabase-admin.ts] ユーザー残高の取得に失敗しました:", error?.message);
    throw new Error("ユーザーのプロファイル情報が取得できませんでした。");
  }

  return data.credits ?? 0;
}

/**
 * 2. 処理に必要なクレジット残高があるかを判定する検証関数
 */
export async function validateUserCredits(
  supabaseAdmin: any,
  userId: string,
  featureKey: FeatureKey
): Promise<{ hasEnough: boolean; currentCredits: number; requiredCredits: number }> {
  const requiredCredits = getRequiredCredits(featureKey);
  const currentCredits = await fetchUserCredits(supabaseAdmin, userId);

  return {
    hasEnough: currentCredits >= requiredCredits,
    currentCredits,
    requiredCredits,
  };
}

/**
 * 3. AI処理成功後に安全にクレジットを減算し、監査ログ（transactions）を記録する関数
 */
export async function deductUserCredits(
  supabaseAdmin: any,
  userId: string,
  featureKey: FeatureKey,
  customCost?: number
): Promise<{ success: boolean; newBalance?: number; error?: string }> {
  const cost = customCost ?? getRequiredCredits(featureKey);

  try {
    // 最新残高の再取得と安全な減算
    const currentCredits = await fetchUserCredits(supabaseAdmin, userId);

    if (currentCredits < cost) {
      return { success: false, error: "クレジットが不足しています。" };
    }

    const newBalance = currentCredits - cost;

    // profiles テーブルの残高を更新
    const { error: updateError } = await supabaseAdmin
      .from("profiles")
      .update({ credits: newBalance })
      .eq("id", userId);

    if (updateError) {
      throw new Error(updateError.message);
    }

    // クレジット利用履歴（監査ログ）を credit_transactions に記録
    const { error: txError } = await supabaseAdmin
      .from("credit_transactions")
      .insert({
        user_id: userId,
        amount: -cost,
        feature_used: featureKey,
        description: `Consumed for ${featureKey} execution`,
      });

    if (txError) {
      // ログ記録の失敗はメイン処理を止めないように警告に留める
      console.warn("⚠️ [supabase-admin.ts] クレジットトランザクションログの記録に失敗しました:", txError.message);
    }

    console.log(`✨ [supabase-admin.ts] クレジット減算成功: ユーザー ${userId}, 消費: -${cost}, 残高: ${newBalance}`);
    return { success: true, newBalance };
  } catch (err: any) {
    console.error("❌ [supabase-admin.ts] クレジット減算処理で例外発生:", err.message);
    return { success: false, error: err.message };
  }
}