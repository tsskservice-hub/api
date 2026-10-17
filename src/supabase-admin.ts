/**
 * @file supabase-admin.ts
 * @description Cloudflare Workers / API環境用の Supabase 管理者クライアントおよびクレジット処理ヘルパー（ロギング堅牢化・自動プロファイル修復対応版）
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
 * （プロファイルが存在しない場合は自動的に初期作成するセーフティ機能付き）
 */
export async function fetchUserCredits(supabaseAdmin: any, userId: string): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("credits")
    .eq("id", userId)
    .maybeSingle(); // .single() だとデータが無い場合にエラーになるため .maybeSingle() を使用

  if (error) {
    console.error("❌ [supabase-admin.ts] ユーザー残高の取得に失敗しました:", error.message);
    throw new Error(`ユーザーのプロファイル情報取得エラー: ${error.message}`);
  }

  // プロファイルレコードがまだ存在しない場合の自動初期化（10クレジット付与）
  if (!data) {
    console.warn(`⚠️ [supabase-admin.ts] ユーザー ${userId} のプロファイルが見つからないため、初期作成します。`);
    const { data: insertData, error: insertError } = await supabaseAdmin
      .from("profiles")
      .insert({ id: userId, credits: 10 })
      .select("credits")
      .single();

    if (insertError || !insertData) {
      console.error("❌ [supabase-admin.ts] 初期プロファイルの作成に失敗しました:", insertError?.message);
      throw new Error("初期プロファイルの作成に失敗しました。");
    }

    return insertData.credits ?? 10;
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
 * 3. クレジットを安全に減算し、監査ログ（credit_transactions）を記録する関数
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
      throw new Error(`Profile update failed: ${updateError.message}`);
    }

    // クレジット利用履歴（監査ログ）を credit_transactions に記録（テーブル未作成やエラーでも処理を止めないよう保護）
    try {
      const { error: txError } = await supabaseAdmin
        .from("credit_transactions")
        .insert({
          user_id: userId,
          amount: -cost,
          feature_used: featureKey,
          description: `Consumed for ${featureKey} execution`,
        });

      if (txError) {
        console.warn("⚠️ [supabase-admin.ts] クレジットトランザクションログの記録に失敗しました:", txError.message);
      }
    } catch (txEx: any) {
      console.warn("⚠️ [supabase-admin.ts] credit_transactions への挿入スキップ:", txEx?.message);
    }

    console.log(`✨ [supabase-admin.ts] クレジット減算成功: ユーザー ${userId}, 消費: -${cost}, 残高: ${newBalance}`);
    return { success: true, newBalance };
  } catch (err: any) {
    console.error("❌ [supabase-admin.ts] クレジット減算処理で例外発生:", err.message);
    return { success: false, error: err.message };
  }
}