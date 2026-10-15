/**
 * @file chat.ts
 * @description Cloudflare Pages Functions用チャットエンドポイント（全9ペルソナ完全対応・動的プロンプト切り替え版）
 */

import { buildAiYamatoContext } from './context.js';
import { buildConciergePrompt } from './concierge.js';
import { buildGameIgoPrompt } from './game-igo.js';
import { buildGenkoyoshiGeneralPrompt } from './genkoyoshi-editor-general.js';
import { buildVceGenkoyoshiPrompt } from './genkoyoshi-editor-vce.js';
import { buildEoyOralDrillPrompt } from './eoy-oral-drill.js';
import { buildEoyOralElaboratePrompt } from './eoy-oral-elaborate.js';
import { buildEoyOralMockPrompt } from './eoy-oral-mock.js';
import { buildEoyWritingPrompt } from './eoy-writing.js';
import { buildOralExamQuestionsPrompt } from './oral-exam-questions.js';

import { getCurrentTimeString } from './time-utils.js';
import { getWeatherInfo } from './weather-utils.js';
import { generateVisualAid } from './imagen-service.js';

export async function onRequestPost(context: any) {
  try {
    const { request, env } = context;
    const body = await request.json() as {
      message: string;
      chatHistory?: Array<{ role: string; content: string }>;
      learningPace?: string;
      userNickname?: string;
      visualPrompt?: string;
      requestVisualAid?: boolean;
      appType?: string;
      systemPrompt?: string;
      portalData?: any; // フロントエンドから送られてくるポータルデータ
    };

    const { 
      message, 
      chatHistory = [], 
      learningPace = "normal", 
      userNickname = "生徒さん",
      visualPrompt,
      requestVisualAid = false,
      appType = "general",
      systemPrompt = "",
      portalData
    } = body;

    // 🔍 【デバッグログ】受信したリクエスト内容を確認
    console.log("📥 [chat.ts] 受信データ:", {
      message,
      requestVisualAid,
      visualPrompt,
      appType,
      learningPace,
      hasPortalData: Boolean(portalData)
    });

    // Cloudflareの環境変数から設定値を取得
    const projectId = env?.VERTEX_AI_PROJECT_ID;
    const region = env?.VERTEX_AI_REGION || "us-central1";
    const serviceAccountJsonStr = env?.GOOGLE_SERVICE_ACCOUNT_JSON;

    if (!projectId || !serviceAccountJsonStr) {
      console.error("❌ Missing config: projectId or serviceAccountJsonStr");
      return new Response(
        JSON.stringify({ 
          reply: "Server configuration error: Vertex AI Project ID or Service Account JSON is missing in Cloudflare environment variables." 
        }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    // 1. サービスアカウントJSONのパース
    let serviceAccount: any;
    try {
      serviceAccount = JSON.parse(serviceAccountJsonStr);
    } catch (e: any) {
      console.error("❌ JSON parse error for GOOGLE_SERVICE_ACCOUNT_JSON:", e.message);
      return new Response(
        JSON.stringify({ reply: "Server configuration error: GOOGLE_SERVICE_ACCOUNT_JSON is not a valid JSON format." }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    // 2. Google OAuth2 アクセストークンの取得
    const accessToken = await getGoogleAccessToken(serviceAccount);
    if (!accessToken) {
      console.error("❌ Failed to obtain Google access token via JWT.");
      return new Response(
        JSON.stringify({ reply: "Failed to authenticate with Google Vertex AI using the provided service account." }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    // 3. 画像生成判定
    const shouldGenerateImage = Boolean(requestVisualAid || visualPrompt);
    console.log("🎨 [chat.ts] 画像生成判定 (shouldGenerateImage):", shouldGenerateImage);

    // 4. appType に応じたシステムプロンプトの構築（全9ペルソナの完全ルーティング）
    let baseSystemPrompt = "";
    const promptOptions = {
      userNickname,
      currentTurn: chatHistory.length + 1,
      portalData: portalData
    };

    switch (appType) {
      case "concierge":
        baseSystemPrompt = await buildConciergePrompt(promptOptions);
        break;
      case "game-igo":
        baseSystemPrompt = await buildGameIgoPrompt(promptOptions);
        break;
      case "genkoyoshi-editor-general":
        baseSystemPrompt = await buildGenkoyoshiGeneralPrompt(promptOptions);
        break;
      case "genkoyoshi-editor-vce":
        baseSystemPrompt = await buildVceGenkoyoshiPrompt(promptOptions);
        break;
      case "eoy-oral-drill":
        baseSystemPrompt = await buildEoyOralDrillPrompt(promptOptions);
        break;
      case "eoy-oral-elaborate":
        baseSystemPrompt = await buildEoyOralElaboratePrompt(promptOptions);
        break;
      case "eoy-oral-mock":
        baseSystemPrompt = await buildEoyOralMockPrompt(promptOptions);
        break;
      case "eoy-writing":
        baseSystemPrompt = await buildEoyWritingPrompt(promptOptions);
        break;
      case "oral-exam-questions":
        baseSystemPrompt = await buildOralExamQuestionsPrompt(promptOptions);
        break;
      default:
        // フォールバック（従来の学習系ヤマト）
        baseSystemPrompt = buildAiYamatoContext({
          learningPace,
          userNickname,
          dialogueCount: chatHistory.length + 1,
          appType: appType as any
        });
        break;
    }

    if (systemPrompt) {
      baseSystemPrompt += `\n\n<CUSTOM_PERSONA_INSTRUCTION>\n${systemPrompt}\n</CUSTOM_PERSONA_INSTRUCTION>`;
    }

    // ★ portalData（価格プランやクレジット情報など）が渡されている場合、コンシェルジュ等のシステムプロンプトに補足
    if (portalData && appType === "concierge") {
      baseSystemPrompt += `\n\n<PORTAL_PRICE_AND_CREDIT_INFO>
CRITICAL FACTUAL DATA ABOUT PLANS & CREDITS:
You must understand and accurately explain the following pricing and credit system when asked:
- The platform uses a Pay-as-you-go / credit purchase model (credits are consumed as students study and interact with Yamato).
- When credits run out, users need to buy more packs.
- Here are the actual price plans available:
${JSON.stringify(portalData, null, 2)}
</PORTAL_PRICE_AND_CREDIT_INFO>`;
    }

    // 5. 時間・天気のコンテキストを生成・結合
    const currentTimeStr = getCurrentTimeString('Australia/Melbourne');
    let weatherInfoStr = "";
    try {
      const weather = await getWeatherInfo('melbourne');
      weatherInfoStr = weather ? String(weather) : "Fine, 20°C";
    } catch (e: any) {
      console.warn("⚠️ [chat.ts] 天気情報の取得に失敗しました:", e.message);
      weatherInfoStr = "Fine, 20°C";
    }

    const timeAndWeatherContext = `
<ENVIRONMENTAL_DATA_SOURCE>
CRITICAL FACTUAL DATA: You MUST use the exact real-time data provided below when asked about the time or weather. Do NOT claim you cannot see the time or weather.
- Current Time (Melbourne, Australia): ${currentTimeStr}
- Current Weather (Melbourne): ${weatherInfoStr}
</ENVIRONMENTAL_DATA_SOURCE>`;

    baseSystemPrompt += timeAndWeatherContext;

    // 言語・ビジュアルルールの適用（原稿用紙VCE等の専門ツールでは日本語指導を許可）
    const isVceTool = appType.startsWith("eoy-") || appType === "genkoyoshi-editor-vce" || appType === "oral-exam-questions";
    const languageRule = isVceTool 
      ? `- LANGUAGE RULE: Support VCE Japanese students with encouraging feedback. You may provide specific Japanese vocabulary, kanji corrections, and grammar suggestions clearly while maintaining a supportive English/Japanese explanation blend as appropriate for VCE tutoring.`
      : `- ABSOLUTE RULE: You MUST write your ENTIRE response strictly in ENGLISH. Japanese is ONLY permitted for target Japanese vocabulary, example sentences, kanji, furigana, or romaji.`;

    baseSystemPrompt += `\n\n<CRITICAL_LANGUAGE_AND_VISUAL_RULES>
${languageRule}
- VISUAL AID STATUS: ${shouldGenerateImage ? "ENABLED. An educational visual diagram is being generated and attached to your response. Introduce it naturally in English (e.g., 'Here is a visual aid to help illustrate this concept!')." : "DISABLED"}
</CRITICAL_LANGUAGE_AND_VISUAL_RULES>`;

    const systemInstruction = {
      role: "system",
      parts: [{ text: baseSystemPrompt }]
    };

    const contents = chatHistory.map(h => ({
      role: h.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: h.content }]
    }));
    contents.push({
      role: 'user',
      parts: [{ text: message }]
    });

    // 6. Vertex AI テキスト生成エンドポイント呼び出し (Gemini 2.5 Flash)
    const modelId = "gemini-2.5-flash";
    const vertexUrl = `https://${region}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${region}/publishers/google/models/${modelId}:generateContent`;

    const vertexResponse = await fetch(vertexUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        systemInstruction: systemInstruction,
        contents: contents,
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 1024,
        }
      })
    });

    if (!vertexResponse.ok) {
      const errorText = await vertexResponse.text();
      console.error(`❌ Vertex AI API error (${vertexResponse.status}):`, errorText);
      throw new Error(`Vertex AI API error (${vertexResponse.status}): ${errorText}`);
    }

    const vertexData = await vertexResponse.json() as any;
    const aiReply = vertexData?.candidates?.[0]?.content?.parts?.[0]?.text || "I'm sorry, I couldn't generate a response.";

    // 7. 画像生成の実行
    let imageUrl: string | undefined = undefined;
    let promptToUse = visualPrompt;

    if (!promptToUse && shouldGenerateImage) {
      promptToUse = `Educational instructional diagram and visual aid for Japanese language learners explaining: ${message}. Clean layout, high quality, professional illustration style.`;
    }

    if (promptToUse) {
      console.log("🚀 [chat.ts] 画像生成サービスを呼び出します。プロンプト:", promptToUse);
      try {
        const base64Image = await generateVisualAid({
          promptText: promptToUse,
          projectId: projectId,
          location: region
        });
        if (base64Image) {
          console.log("✨ [chat.ts] 画像生成成功！データサイズ(Base64):", base64Image.length);
          imageUrl = `data:image/png;base64,${base64Image}`;
        } else {
          console.warn("⚠️ [chat.ts] 画像生成は実行されましたが、base64Imageが取得できませんでした。");
        }
      } catch (err: any) {
        console.error("❌ [chat.ts] 画像生成エラー詳細:", err.message, err.stack);
      }
    } else {
      console.log("ℹ️ [chat.ts] promptToUse が空のため、画像生成はスキップされました。");
    }

    return new Response(
      JSON.stringify({
        reply: aiReply,
        imageUrl: imageUrl,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );

  } catch (err: any) {
    console.error("❌ Unhandled Exception in onRequestPost:", err.message, err.stack);
    return new Response(
      JSON.stringify({ 
        reply: "Sorry, I encountered an error while processing your request with AI Yamato.", 
        error: err.message 
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

// ─── JWT-Bearer 方式のアクセストークン取得ヘルパー ───
async function getGoogleAccessToken(serviceAccount: any): Promise<string | null> {
  try {
    const header = { alg: "RS256", typ: "JWT" };
    const now = Math.floor(Date.now() / 1000);
    const exp = now + 3600;

    const payload = {
      iss: serviceAccount.client_email,
      scope: "https://www.googleapis.com/auth/cloud-platform",
      aud: serviceAccount.token_uri,
      iat: now,
      exp: exp,
    };

    const base64UrlEncode = (str: string) => 
      btoa(unescape(encodeURIComponent(str))).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

    const unsignedToken = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(payload))}`;

    const pemHeader = "-----BEGIN PRIVATE KEY-----";
    const pemFooter = "-----END PRIVATE KEY-----";
    let pemContents = serviceAccount.private_key;
    if (pemContents.includes(pemHeader)) {
      pemContents = pemContents.replace(pemHeader, "").replace(pemFooter, "");
    }
    pemContents = pemContents.replace(/\s/g, "");

    const binaryDer = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));

    const key = await crypto.subtle.importKey(
      "pkcs8",
      binaryDer.buffer,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"]
    );

    const signature = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      key,
      new TextEncoder().encode(unsignedToken)
    );

    const base64UrlSignature = btoa(String.fromCharCode(...new Uint8Array(signature)))
      .replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

    const jwt = `${unsignedToken}.${base64UrlSignature}`;

    const tokenRes = await fetch(serviceAccount.token_uri, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}&assertion=${encodeURIComponent(jwt)}`
    });

    if (!tokenRes.ok) {
      const tokenErrText = await tokenRes.text();
      console.error("Google Token Endpoint error:", tokenErrText);
      return null;
    }

    const tokenData = await tokenRes.json() as any;
    return tokenData.access_token || null;
  } catch (e: any) {
    console.error("Token generation internal error:", e.message);
    return null;
  }
}