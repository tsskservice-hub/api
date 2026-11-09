/**
 * @file src/handlers/realtime-audio-handler.ts
 * @description OpenAI Realtime API (GA仕様 / client_secrets) を用いた日本語スピーキング課題のセッション発行ハンドラー
 */

import { Context } from 'hono';
import { checkCreditBalance, executeCreditDeduction } from './credit-handler';
import { buildObentoU4YamatoPrompt } from '../prompts/obento-u4';
import { buildEoyOralAcceleratedPrompt } from '../prompts/eoy-oral-accelerated'; // 💡 Accelerated用プロンプト生成関数をインポート

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

    // 📜 アプリタイプやレッスンに応じた専門プロンプトを動的に生成
    let dynamicSystemPrompt = "";
    
    if (appType.includes("accelerated") || lessonSlug.includes("accelerated")) {
      // ⚡ Accelerated トラック用の高度なプロンプトを構築
      dynamicSystemPrompt = await buildEoyOralAcceleratedPrompt({
        userNickname: body.userNickname || "VCE Accelerated Student",
        env: c.env,
      });
    } else if (appType.includes("obento-unit-4") || lessonSlug.includes("obento-unit-4")) {
      // 📘 Obento Unit 4 初級・定着用の厳格プロンプトを構築
      dynamicSystemPrompt = await buildObentoU4YamatoPrompt({
        lessonSlug,
        userNickname: body.userNickname || "Student",
        env: c.env,
      });
    } else {
      dynamicSystemPrompt = `You are a helpful Japanese language conversation partner.`;
    }

    // 🐢 初心者向け（Obento等）の場合はスロースピードを適用。Acceleratedの場合は自然な会話スピードを維持。
    let speedRules = "";
    if (!appType.includes("accelerated") && !lessonSlug.includes("accelerated")) {
      speedRules = `
=== SPEECH PACE & PACING RULES (CRITICAL) ===
- YOU MUST SPEAK EXTREMELY SLOWLY. Imagine you are talking to a complete beginner who struggles to catch words.
- Pause significantly between words and sentences. Do not rush.
- Articulate every single syllable clearly and distinctly.
`;
    } else {
      speedRules = `
=== SPEECH PACE & PACING RULES ===
- Speak at a natural, standard native conversational speed suitable for high-achieving VCE students.
`;
    }

    const taskRules = `
=== SPEAKING TASK RULES (Strictly Follow) ===
1. Task Topic / Focus: ${customTopic}
2. Turn-Taking & Flow:
   - Guide the student through the conversation naturally.
3. Completion:
   - When the conversation reaches its goal or finishes, include an appropriate polite closing statement.
`;

    const finalInstructions = `${dynamicSystemPrompt}\n\n${speedRules}\n\n${taskRules}`;

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
              voice: appType.includes("accelerated") ? "alloy" : "shimmer", // Acceleratedは自然なalloy、初級は聞き取りやすいshimmer
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
    console.error("❌ [REALTIME-HANDLER VERY CRITICAL ERROR]:", err?.message || String(err));
    return c.json({ error: err?.message || 'Internal Server Error' }, 500);
  }
}

export default handleRealtimeSessionRequest;