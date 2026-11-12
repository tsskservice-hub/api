/**
 * @file supabase-admin.ts
 * @description Cloudflare Workers / API環境用の Supabase 管理者クライアントおよびクレジット処理ヘルパー（ロギング堅牢化・自動プロファイル修復対応版）
 */

import { createClient } from "@supabase/supabase-js";
import { FeatureKey } from "../credit-rules.js";

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
 * 2. クレジットを「残高が足りるときだけ」1回で引く関数（データベース関数 consume_credits）
 *    読む→計算→書き戻す、を分けないので、同時にリクエストが来ても二重使用できない
 */
export async function consumeUserCredits(
  supabaseAdmin: any,
  userId: string,
  amount: number,
  featureKey: FeatureKey
): Promise<{ ok: boolean; balance: number }> {
  const { data, error } = await supabaseAdmin.rpc("consume_credits", {
    p_user_id: userId,
    p_amount: amount,
    p_feature: featureKey,
  });
  if (error) {
    throw new Error(`consume_credits failed: ${error.message}`);
  }
  return { ok: Boolean(data?.ok), balance: Number(data?.balance ?? 0) };
}

/**
 * 3. AI の処理が失敗したときに、引いたクレジットを返す関数（データベース関数 refund_credits）
 */
export async function refundUserCredits(
  supabaseAdmin: any,
  userId: string,
  amount: number,
  featureKey: FeatureKey
): Promise<void> {
  const { error } = await supabaseAdmin.rpc("refund_credits", {
    p_user_id: userId,
    p_amount: amount,
    p_feature: featureKey,
  });
  if (error) {
    throw new Error(`refund_credits failed: ${error.message}`);
  }
}

/**
 * 4. クレジットを安全に加算（チャージ・付与）し、監査ログ（credit_transactions）を記録する関数
 */
export async function addUserCredits(
  supabaseAdmin: any,
  userId: string,
  amount: number,
  description: string = "Credit top-up"
): Promise<{ success: boolean; newBalance?: number; error?: string }> {
  if (amount <= 0) {
    return { success: false, error: "加算するクレジット数は1以上を指定してください。" };
  }

  try {
    // 最新残高を取得（プロファイル未作成の場合は自動作成される仕様をそのまま利用）
    const currentCredits = await fetchUserCredits(supabaseAdmin, userId);
    const newBalance = currentCredits + amount;

    // profiles テーブルの残高を加算後の数値で更新
    const { error: updateError } = await supabaseAdmin
      .from("profiles")
      .update({ credits: newBalance })
      .eq("id", userId);

    if (updateError) {
      throw new Error(`Profile update failed: ${updateError.message}`);
    }

    // クレジット取得・チャージ履歴（監査ログ）を credit_transactions に記録
    try {
      const { error: txError } = await supabaseAdmin
        .from("credit_transactions")
        .insert({
          user_id: userId,
          amount: amount, // 正の数値を記録
          feature_used: "credit_charge",
          description: description,
        });

      if (txError) {
        console.warn("⚠️ [supabase-admin.ts] クレジットトランザクションログの記録に失敗しました:", txError.message);
      }
    } catch (txEx: any) {
      console.warn("⚠️ [supabase-admin.ts] credit_transactions への挿入スキップ:", txEx?.message);
    }

    console.log(`✨ [supabase-admin.ts] クレジット加算成功: ユーザー ${userId}, 追加: +${amount}, 最新残高: ${newBalance}`);
    return { success: true, newBalance };
  } catch (err: any) {
    console.error("❌ [supabase-admin.ts] クレジット加算処理で例外発生:", err.message);
    return { success: false, error: err.message };
  }
}