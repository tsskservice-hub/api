/**
 * @file src/handlers/credit-handler.ts
 * @description Supabase DB と連携したユーザークレジットの消費（先払い）と返却を行う独立モジュール
 *
 * 流れ:
 *   1. reserveCredits()  … AI を呼ぶ「前」に、残高が足りるときだけクレジットを引く（DB 関数で1回で行う）
 *   2. AI の処理
 *   3. 失敗したら refundCredits() で返す
 * 同時にリクエストが来ても、残高を超えて使うことはできない。
 */

import { Context } from 'hono';
import { getSupabaseAdmin, consumeUserCredits, refundUserCredits } from '../services/supabase-admin';
import { determineRequiredCreditsFromPayload, getRequiredCredits, FeatureKey, SERVER_CREDIT_COSTS } from '../credit-rules';

export interface CreditReservation {
  ok: boolean;
  userId: string;
  featureKey: FeatureKey;
  amount: number;
  /** 返却済みかどうか（二重に返さないため） */
  refunded?: boolean;
  errorResponse?: Response;
}

/**
 * リクエスト内容から、どの機能（FeatureKey）かを判定する
 */
function determineFeatureKey(body: any): FeatureKey {
  const requiredCredits = determineRequiredCreditsFromPayload(body);

  if (body.featureKey && body.featureKey in SERVER_CREDIT_COSTS) {
    return body.featureKey;
  }
  if (requiredCredits >= 10) return 'mockFull';
  if (requiredCredits === 6) {
    if (body.isMockSection === "2" || body.appType === "eoy-oral-mock-section2") return 'mockSection2';
    if (body.isMockSection === "1" || body.appType === "eoy-oral-mock-section1") return 'mockSection1';
    return 'multiImageAi';
  }
  if (requiredCredits === 4 && (body.isVoiceMode === 'elaborate' || body.appType === 'eoy-oral-elaborate')) return 'voiceElaborate';
  if (requiredCredits === 4) return 'imageAi';
  if (requiredCredits === 3 && (body.isVoiceMode === 'drill' || body.appType === 'eoy-oral-drill')) return 'voiceDrill';
  return 'textAi';
}

/**
 * 💳 AI を呼ぶ前にクレジットを引く（先払い）
 * 残高が足りなければ 402、確認できなければ 503 を errorResponse に入れて返す。
 */
export async function reserveCredits(
  c: Context,
  body: any,
  effectiveUserId: string
): Promise<CreditReservation> {
  const featureKey = determineFeatureKey(body);
  const amount = getRequiredCredits(featureKey);
  const base = { userId: effectiveUserId, featureKey, amount };

  if (!effectiveUserId) {
    return {
      ...base,
      ok: false,
      errorResponse: c.json({ error: "LOGIN_REQUIRED", reply: "Please log in to use AI Yamato." }, 401),
    };
  }

  try {
    const supabaseAdmin = getSupabaseAdmin(c.env);
    console.log(`💳 [Supabase] Consuming credits for user: ${effectiveUserId}, Feature: ${featureKey}, Amount: ${amount}`);

    const { ok, balance } = await consumeUserCredits(supabaseAdmin, effectiveUserId, amount, featureKey);

    if (!ok) {
      if (balance <= 0) {
        return {
          ...base,
          ok: false,
          errorResponse: c.json({
            error: "ZERO_CREDITS",
            message: "クレジットがゼロです。学習を継続するにはプランのアップグレードまたはクレジットの追加が必要です。",
            reply: "Your credit balance is 0. Please top up your credits to continue learning.",
            currentCredits: balance,
            requiredCredits: amount,
          }, 402),
        };
      }
      return {
        ...base,
        ok: false,
        errorResponse: c.json({
          error: "PARTIAL_SHORTAGE",
          message: `この機能には ${amount} クレジット必要ですが、現在の残高は ${balance} クレジットです。`,
          reply: `Insufficient credits. This action requires ${amount} credits (you have ${balance}).`,
          currentCredits: balance,
          requiredCredits: amount,
        }, 402),
      };
    }

    return { ...base, ok: true };
  } catch (dbErr: any) {
    // 残高を確認できないときは、使わせない（安全側に倒す）
    console.error("❌ [Supabase] Credit consume exception:", dbErr?.message || String(dbErr));
    return {
      ...base,
      ok: false,
      errorResponse: c.json({
        error: "CREDIT_CHECK_FAILED",
        message: "クレジット残高を確認できませんでした。しばらくしてからもう一度お試しください。",
        reply: "We could not check your credit balance. Please try again later.",
      }, 503),
    };
  }
}

/**
 * ↩️ AI の処理が失敗したときに、先に引いたクレジットを返す
 * 引いていない場合・返却済みの場合は何もしない。
 */
export async function refundCredits(env: any, reservation: CreditReservation | null | undefined) {
  if (!reservation || !reservation.ok || reservation.refunded) return;
  reservation.refunded = true;

  try {
    const supabaseAdmin = getSupabaseAdmin(env);
    console.log(`↩️ [Supabase] Refunding credits for user: ${reservation.userId}, Feature: ${reservation.featureKey} (+${reservation.amount})`);
    await refundUserCredits(supabaseAdmin, reservation.userId, reservation.amount, reservation.featureKey);
  } catch (refundErr: any) {
    console.error("❌ [Supabase] Failed to refund credits:", refundErr?.message || String(refundErr));
  }
}
