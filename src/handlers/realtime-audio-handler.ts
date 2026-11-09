/**
 * @file src/handlers/realtime-audio-handler.ts
 * @description Google Cloud Vertex AI (Gemini 2.5 Flash) を用いた日本語スピーキング課題の対話処理ハンドラー（Vertex AI移行版）
 */

import { Context } from 'hono';
import { checkCreditBalance, executeCreditDeduction } from './credit-handler';
import { buildObentoU4YamatoPrompt } from '../prompts/obento-u4';
import { getGoogleAccessToken } from '../services/google-auth';

export async function handleRealtimeSessionRequest(c: Context) {
  try {
    const body = (await c.req.json().catch(() => ({}))) as any;
    const effectiveUserId = body.userId || "test-guest-user";
    const appType = body.appType || "";
    const lessonSlug = body.lessonSlug || "obento-unit-4-lesson-1";
    const customTopic = body.topic || "家族の人数や構成、ペットについての質問と答え方の練習";
    const history = body.chatHistory || body.history || [];
    const userMessage = body.message || "こんにちは、家族の人数や構成についてのスピーキング課題を始めます。";

    const serviceAccountKey = c.env.VERTEX_AI_KEY || c.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    const projectId = c.env.VERTEX_AI_PROJECT_ID;
    const region = c.env.VERTEX_AI_REGION || "us-central1";

    if (!serviceAccountKey || !projectId) {
      return c.json({ error: "VERTEX_AI_KEY or VERTEX_AI_PROJECT_ID is not configured on server environment variables." }, 500);
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
   - When the conversation reaches its goal or 5 turns, include a polite closing statement.
`;

    const systemInstructionText = `${dynamicSystemPrompt}\n\n${taskRules}`;

    // 🔐 Google Access Token 取得
    const accessToken = await getGoogleAccessToken(serviceAccountKey);

    // 💬 履歴とユーザーメッセージの組み立て
    const contents = [
      ...history.map((h: any) => ({
        role: h.role === 'assistant' ? 'model' : 'user',
        parts: 'parts' in h && Array.isArray(h.parts) ? h.parts : [{ text: h.content || '' }],
      })),
      { role: 'user', parts: [{ text: userMessage }] },
    ];

    const gDomain = ["google", "apis"].join("");
    const vertexHost = region + "-aiplatform." + gDomain + ".com";
    const vertexUrl = `https://${vertexHost}/v1/projects/${projectId}/locations/${region}/publishers/google/models/gemini-2.5-flash:generateContent`;

    const vertexRes = await fetch(vertexUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + accessToken,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemInstructionText }] },
        contents,
      }),
    });

    if (!vertexRes.ok) {
      const errText = await vertexRes.text();
      console.error("❌ Vertex AI API Error:", errText);
      return c.json({ error: "Vertex AI API Error: " + errText }, 500);
    }

    const data = (await vertexRes.json()) as any;
    const aiReply = data.candidates?.[0]?.content?.parts?.[0]?.text || '申し訳ありません。うまく理解できませんでした。';

    // 💳 クレジット引き落としの実行
    await executeCreditDeduction(c.env, effectiveUserId, creditCheck.featureKey, creditCheck.requiredCredits);

    return c.json({
      success: true,
      reply: aiReply,
    });
  } catch (err: any) {
    console.error("❌ [REALTIME-HANDLER CRITICAL ERROR]:", err?.message || String(err));
    return c.json({ error: err?.message || 'Internal Server Error' }, 500);
  }
}

export default handleRealtimeSessionRequest;