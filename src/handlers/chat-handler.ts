/**
 * @file src/handlers/chat-handler.ts
 * @description /chat および /api/chat のメイン対話処理を担当する独立ハンドラーモジュール
 */

import { Context } from 'hono';
import { getGoogleAccessToken } from '../services/google-auth';
import { generateOpenAiTts } from '../services/tts-service';
import { generateVisualAid } from '../services/imagen-service';
import { dispatchSystemPrompt } from '../prompts/prompt-dispatcher';
import { checkCreditBalance, executeCreditDeduction } from './credit-handler';
import { getSyncedKnowledge } from '../api-sync-knowledge';

export async function handleChatOrTtsRequest(c: Context) {
  try {
    const body = (await c.req.json()) as any;
    const isTtsEndpoint = c.req.path.includes("test-tts");

    const rawTtsText =
      body.speakText ||
      body.textToSpeak ||
      body.text ||
      body.input ||
      body.prompt ||
      (isTtsEndpoint ? body.message : undefined);

    let cleanedTtsText = "";
    if (rawTtsText && typeof rawTtsText === "string") {
      cleanedTtsText = rawTtsText
        .replace(/<rt>.*?<\/rt>/g, "")
        .replace(/<[^>]*>/g, "")
        .replace(/【.*?】/g, "")
        .replace(/※.*$/gm, "")
        .trim();
    }

    // 🔊 1. TTS リクエストの場合
    if (cleanedTtsText || isTtsEndpoint) {
      const textToSpeak = cleanedTtsText || body.message || "こんにちは";
      const openaiApiKey = c.env.OPENAI_API_KEY;

      if (!openaiApiKey) {
        return c.json({ error: "OPENAI_API_KEY is not configured on server environment variables." }, 500);
      }

      const voiceToUse = body.voice || "fable";
      const speedToUse = typeof body.speed === "number" ? body.speed : 1.0;
      const origin = c.req.header("Origin") || "*";

      return await generateOpenAiTts(textToSpeak, openaiApiKey, voiceToUse, speedToUse, origin);
    }

    // 💬 2. 通常の AI チャット（Gemini / Vertex AI）処理
    const effectiveUserId = body.userId || "test-guest-user";
    const userMessage = body.message;
    const history = body.chatHistory || body.history || [];

    const hasAnyQuestionImages =
      Boolean(body.questionImagesBase64 && body.questionImagesBase64.length > 0) ||
      Boolean(body.questionImageBase64);

    if (!userMessage && !body.imageBase64 && !hasAnyQuestionImages) {
      return c.json({ error: 'Message or image is required' }, 400);
    }

    const serviceAccountKey = c.env.VERTEX_AI_KEY || c.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    const projectId = c.env.VERTEX_AI_PROJECT_ID;
    const region = c.env.VERTEX_AI_REGION || "us-central1";

    if (!serviceAccountKey || !projectId) {
      return c.json({
        error: 'VERTEX_AI_KEY or VERTEX_AI_PROJECT_ID is not configured',
        reply: 'Server configuration error: AI keys are missing.'
      }, 500);
    }

    // 💳 クレジットの事前チェック
    const creditCheck = await checkCreditBalance(c, body, effectiveUserId);
    if (!creditCheck.hasPermission) {
      return creditCheck.errorResponse!;
    }

    // 🔐 Google Access Token 取得
    const accessToken = await getGoogleAccessToken(serviceAccountKey);

    // 📜 システム指示プロンプトの構築
    const appType = body.appType || "general";
    const syncedKnowledge = await getSyncedKnowledge(c.env);

    const promptOptions = {
      userNickname: body.userNickname || "my friend",
      faqList: syncedKnowledge?.faqList || [],
      currentTurn: history.length + 1,
      pace: body.learningPace || body.pace,
      selectedTextType: body.selectedTextType,
      studentEssay: body.studentEssay || userMessage,
      exactCharacterCount: body.exactCharacterCount,
      writingSection: body.writingSection || "section2b",
      hasFiles: Boolean(body.imageBase64 || hasAnyQuestionImages),
      assignedQuestion: body.assignedQuestion || (hasAnyQuestionImages ? "[External Question Images Attached for AI OCR]" : userMessage),
      timeZone: body.timeZone,
      cityName: body.cityName,
      env: c.env,
    };

    const promptResult = await dispatchSystemPrompt(appType, promptOptions, body.systemPrompt);

    if (!promptResult.success) {
      return c.json(promptResult.errorResponse, 400);
    }

    const systemInstructionText = promptResult.systemInstructionText!;

    // マルチモーダルパラメータの組み立て
    const userParts: any[] = [{ text: userMessage || "Please evaluate my answer against my question." }];

    if (body.questionImagesBase64 && Array.isArray(body.questionImagesBase64)) {
      for (const qImg of body.questionImagesBase64) {
        const qMatches = qImg.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
        if (qMatches && qMatches.length === 3) {
          userParts.push({ inline_data: { mime_type: qMatches[1], data: qMatches[2] } });
        }
      }
    } else if (body.questionImageBase64) {
      const qMatches = body.questionImageBase64.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
      if (qMatches && qMatches.length === 3) {
        userParts.push({ inline_data: { mime_type: qMatches[1], data: qMatches[2] } });
      }
    }

    if (body.imageBase64) {
      const aMatches = body.imageBase64.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
      if (aMatches && aMatches.length === 3) {
        userParts.push({ inline_data: { mime_type: aMatches[1], data: aMatches[2] } });
      }
    }

    const contents = [
      ...history.map((h: any) => ({
        role: h.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: h.content }],
      })),
      { role: 'user', parts: userParts },
    ];

    const gDomain = ["google", "apis"].join("");
    const vertexHost = region + "-aiplatform." + gDomain + ".com";
    const vertexUrl =
      "https://" +
      vertexHost +
      "/v1/projects/" +
      projectId +
      "/locations/" +
      region +
      "/publishers/google/models/gemini-2.5-flash:generateContent";

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
    const aiReply =

  data.candidates?.[0]?.content?.parts?.[0]?.text || '申し訳ありません。うまく理解できませんでした。';

    let imageUrl: string | undefined = undefined;
    let promptToUse = body.visualPrompt;
    const shouldGenerateImage = Boolean(body.requestVisualAid || body.visualPrompt);

    if (!promptToUse && shouldGenerateImage) {
      promptToUse =
        "Educational instructional diagram and visual aid for Japanese language learners explaining: " +
        userMessage +
        ". Clean layout, high quality, professional illustration style.";
    }

    // 🎨 画像生成AI処理 (imagen-service.ts を利用)
    if (promptToUse) {
      try {
        const base64Image = await generateVisualAid({
          promptText: promptToUse,
          projectId: projectId,
          location: global,
          serviceAccountKey: serviceAccountKey, // 💡 認証キーを確実に引き渡す
        });
        if (base64Image) {
          imageUrl = "data:image/png;base64," + base64Image;
        }
      } catch (err: any) {
        console.error("❌ Image generation error in /chat:", err?.message || String(err));
      }
    }

    // 💳 クレジット引き落としの実行
    await executeCreditDeduction(c.env, effectiveUserId, creditCheck.featureKey, creditCheck.requiredCredits);

    return c.json({ reply: aiReply, imageUrl: imageUrl });
  } catch (e: any) {
    console.error("❌ Unhandled exception in /chat or /api/test-tts:", e?.message || String(e));
    return c.json(
      {
        error: e?.message || 'Internal Server Error',
        reply: 'Sorry, an error occurred while processing your request.',
      },
      500
    );
  }
}