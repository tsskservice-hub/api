/**
 * @file src/handlers/realtime-audio-handler.ts
 * @description OpenAI Realtime API (GA仕様 / client_secrets) を用いた日本語スピーキング課題のセッション発行ハンドラー
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

    // 📜 ユニットごとの専門プロンプト（obento-u4.ts）を動的に生成
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

    const taskRules = `
=== SPEAKING TASK RULES (Strictly Follow) ===
1. Task Topic / Focus: ${customTopic}
2. Turn-Taking & Flow:
   - Engage in a controlled conversation. Guide the student through the conversation naturally.
   - Use simple, clear Japanese appropriate for beginner learners.
   - Check if they use correct counters (e.g., ひとり, ふたり) or particles.
3. Completion:
   - When the conversation reaches its goal or 5 turns, include a polite closing statement: "お疲れ様でした！これで今回のスピーキング課題は終了です。"
`;

    const finalInstructions = `${dynamicSystemPrompt}\n\n${taskRules}`;

    // 🎙️ OpenAI Realtime API (GA仕様: client_secrets) へ一時トークンを要求
    const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openaiApiKey.trim()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        session: {
          type: "realtime",
          model: "gpt-realtime",
          instructions: finalInstructions,
          audio: {
            output: {
              voice: "shimmer", // AIヤマトの音声プロファイル（お好みで変更可能）
            },
          },
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("❌ OpenAI Realtime Error Status:", response.status);
      console.error("❌ OpenAI Realtime Error Body:", errText);
      return c.json({ error: `Realtime connection initialization failed (${response.status})` }, 502);
    }

    const data = (await response.json()) as any;

    // 💳 クレジット引き落としの実行
    await executeCreditDeduction(c.env, effectiveUserId, creditCheck.featureKey, creditCheck.requiredCredits);

    return c.json(
      {
        success: true,
        value: data.value,
        expires_at: data.expires_at,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (err: any) {
    console.error("❌ [REALTIME-HANDLER CRITICAL ERROR]:", err?.message || String(err));
    return c.json({ error: err?.message || 'Internal Server Error' }, 500);
  }
}

export default handleRealtimeSessionRequest;