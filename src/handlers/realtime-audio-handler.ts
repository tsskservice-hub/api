/**
 * @file src/handlers/realtime-audio-handler.ts
 * @description OpenAI Realtime API のエフェメラルセッション（一時トークン）を発行するハンドラー（修正版）
 */

import { Context } from 'hono';
import { checkCreditBalance, executeCreditDeduction } from './credit-handler';
import { buildObentoU4YamatoPrompt } from '../prompts/obento-u4';

export async function handleRealtimeSessionRequest(c: Context) {
  try {
    const body = (await c.req.json().catch(() => ({}))) as any;
    const effectiveUserId = body.userId || "test-guest-user";
    const appType = body.appType || "";
    const lessonSlug = body.lessonSlug || "obento-unit-4-lesson-1";
    const customTopic = body.topic || "家族の人数や構成、ペットについての質問と答え方の練習";

    const openaiApiKey = c.env.OPENAI_API_KEY;
    if (!openaiApiKey) {
      return c.json({ error: "OPENAI_API_KEY is not configured on server environment variables." }, 500);
    }

    // 💳 クレジットの事前チェック
    const creditCheck = await checkCreditBalance(c, body, effectiveUserId);
    if (!creditCheck.hasPermission) {
      return creditCheck.errorResponse!;
    }

    // 📜 ユニットごとの専門プロンプト
    let dynamicSystemPrompt = "";
    if (appType.includes("obento-unit-4") || lessonSlug.includes("obento-unit-4")) {
      dynamicSystemPrompt = await buildObentoU4YamatoPrompt({
        lessonSlug,
        userNickname: body.userNickname || "Student",
        env: c.env,
      });
    } else {
      dynamicSystemPrompt = `You are a helpful Japanese language conversation partner.`;
    }

    const realtimeControlRules = `
=== REALTIME SPEAKING TASK CONTROL RULES ===
1. Task Topic / Focus: ${customTopic}
2. Turn-Taking & Flow:
   - You (AI) must speak FIRST in Japanese to greet the student and ask the first question.
   - Wait for the student's voice response.
   - Engage in a controlled conversation that lasts for EXACTLY 5 turns.
3. Pedagogical Support:
   - Use simple, clear Japanese appropriate for beginner learners.
   - Check if they use correct counters (e.g., ひとり, ふたり) or particles.
4. Completion:
   - After the 5th turn, finish by saying: "お疲れ様でした！これで今回のスピーキング課題は終了です。"
`;

    const finalInstructions = `${dynamicSystemPrompt}\n\n${realtimeControlRules}`;

    // 🎙️ OpenAI Realtime API エフェメラルセッションの作成（※ OpenAI-Beta ヘッダーが必須）
    const response = await fetch("https://api.openai.com/v1/realtime/sessions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openaiApiKey}`,
        "Content-Type": "application/json",
        "OpenAI-Beta": "realtime=v1", // 👈 ここが必須のヘッダーです
      },
      body: JSON.stringify({
        model: "gpt-4o-realtime-preview-2024-10-13", // 👈 正式なバージョン付きモデル名を指定すると確実です
        voice: "shimmer",
        instructions: finalInstructions,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("❌ OpenAI Realtime Session API Error:", errText);
      return c.json({ error: "Failed to create realtime session: " + errText }, 500);
    }

    const data = (await response.json()) as any;

    // 💳 クレジット引き落としの実行
    await executeCreditDeduction(c.env, effectiveUserId, creditCheck.featureKey, creditCheck.requiredCredits);

    return c.json({
      success: true,
      session: data,
    });
  } catch (err: any) {
    console.error("❌ [REALTIME-HANDLER CRITICAL ERROR]:", err?.message || String(err));
    return c.json({ error: err?.message || 'Internal Server Error' }, 500);
  }
}

export default handleRealtimeSessionRequest;