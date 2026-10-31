/**
 * @file src/handlers/credit-handler.ts
 * @description Supabase DB と連携したユーザークレジット残高の検証および引き落とし処理を行う独立モジュール
 */

import { Context } from 'hono';
import { getSupabaseAdmin, validateUserCredits, deductUserCredits } from '../supabase-admin';
import { determineRequiredCreditsFromPayload, FeatureKey, SERVER_CREDIT_COSTS } from '../credit-rules';

export interface CreditCheckResult {
  hasPermission: boolean;
  requiredCredits: number;
  featureKey: FeatureKey;
  errorResponse?: Response;
}

/**
 * 💡 ユーザーのクレジット残高を事前検証する
 * @param c Hono Context
 * @param body リクエストボディ
 * @param effectiveUserId ユーザーID
 */
export async function checkCreditBalance(
  c: Context,
  body: any,
  effectiveUserId: string
): Promise<CreditCheckResult> {
  // 必要クレジット数の判定 (credit-rules.ts を使用)
  const requiredCredits = determineRequiredCreditsFromPayload(body);

  const featureKey: FeatureKey = (body.featureKey && (body.featureKey in SERVER_CREDIT_COSTS))
    ? body.featureKey
    : requiredCredits >= 10
    ? 'mockFull'
    : requiredCredits === 6
    ? ( (body.isMockSection === "2" || body.appType === "eoy-oral-mock-section2") ? 'mockSection2' : (body.isMockSection === "1" || body.appType === "eoy-oral-mock-section1") ? 'mockSection1' : 'multiImageAi' )
    : (requiredCredits === 4 && (body.isVoiceMode === 'elaborate' || body.appType === 'eoy-oral-elaborate'))
    ? 'voiceElaborate'
    : requiredCredits === 4
    ? 'imageAi'
    : (requiredCredits === 3 && (body.isVoiceMode === 'drill' || body.appType === 'eoy-oral-drill'))
    ? 'voiceDrill'
    : 'textAi';

  if (effectiveUserId === "test-guest-user") {
    return { hasPermission: true, requiredCredits, featureKey };
  }

  try {
    const supabaseAdmin = getSupabaseAdmin(c.env);
    if (supabaseAdmin) {
      console.log(`🔍 [Supabase] Checking credits for user: ${effectiveUserId}, Feature: ${featureKey}, Required: ${requiredCredits}`);

      const creditCheck = await validateUserCredits(supabaseAdmin, effectiveUserId, featureKey);
      const { hasEnough, currentCredits } = creditCheck;

      if (!hasEnough) {
        if (currentCredits <= 0) {
          return {
            hasPermission: false,
            requiredCredits,
            featureKey,
            errorResponse: c.json({
              error: "ZERO_CREDITS",
              message: "クレジットがゼロです。学習を継続するにはプランのアップグレードまたはクレジットの追加が必要です。",
              reply: "Your credit balance is 0. Please top up your credits to continue learning.",
              currentCredits,
              requiredCredits
            }, 402)
          };
        }

        return {
          hasPermission: false,
          requiredCredits,
          featureKey,
          errorResponse: c.json({
            error: "PARTIAL_SHORTAGE",
            message: `この機能には ${requiredCredits} クレジット必要ですが、現在の残高は ${currentCredits} クレジットです。`,
            reply: `Insufficient credits. This action requires ${requiredCredits} credits (you have ${currentCredits}).`,
            currentCredits,
            requiredCredits
          }, 402)
        };
      }
    }
  } catch (dbErr: any) {
    console.error("❌ [Supabase] Database check exception caught:", dbErr?.message || String(dbErr));
  }

  return { hasPermission: true, requiredCredits, featureKey };
}

/**
 * 💡 処理完了後にクレジットを引き落とす
 * @param env Cloudflare Bindings
 * @param effectiveUserId ユーザーID
 * @param featureKey 機能キー
 * @param requiredCredits 消費クレジット数
 */
export async function executeCreditDeduction(
  env: any,
  effectiveUserId: string,
  featureKey: FeatureKey,
  requiredCredits: number
) {
  if (effectiveUserId === "test-guest-user") return;

  try {
    const supabaseAdmin = getSupabaseAdmin(env);
    if (supabaseAdmin) {
      console.log(`💳 [Supabase] Deducting credits for user: ${effectiveUserId}, Feature: ${featureKey} (Cost: ${requiredCredits})`);
      await deductUserCredits(supabaseAdmin, effectiveUserId, featureKey);
    }
  } catch (deductErr: any) {
    console.error("❌ [Supabase] Failed to deduct credits:", deductErr?.message || String(deductErr));
  }
}