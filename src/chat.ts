/**
 * @file chat.ts
 * @description Cloudflare Pages Functions用チャットエンドポイント（context.ts, 時間・天気統合 ＆ 画像生成AI連携完全版）
 */

import { buildAiYamatoContext } from '../../src/ai/context.js';
import { buildSystemInstructionWithTimeAndWeather } from '../../src/ai/time-utils.js';
import { generateVisualAid } from '../../src/ai/imagen-service.js';

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
    };

    const { 
      message, 
      chatHistory = [], 
      learningPace = "normal", 
      userNickname = "生徒さん",
      visualPrompt,
      requestVisualAid = false
    } = body;

    // Cloudflareの環境変数から設定値を取得
    const projectId = env?.VERTEX_AI_PROJECT_ID;
    const region = env?.VERTEX_AI_REGION || "us-central1";
    const serviceAccountJsonStr = env?.GOOGLE_SERVICE_ACCOUNT_JSON;

    if (!projectId || !serviceAccountJsonStr) {
      console.error("Missing config: projectId or serviceAccountJsonStr");
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
      console.error("JSON parse error for GOOGLE_SERVICE_ACCOUNT_JSON:", e.message);
      return new Response(
        JSON.stringify({ reply: "Server configuration error: GOOGLE_SERVICE_ACCOUNT_JSON is not a valid JSON format." }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    // 2. Google OAuth2 アクセストークンの取得
    const accessToken = await getGoogleAccessToken(serviceAccount);
    if (!accessToken) {
      console.error("Failed to obtain Google access token via JWT.");
      return new Response(
        JSON.stringify({ reply: "Failed to authenticate with Google Vertex AI using the provided service account." }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    // 3. 画像生成判定（チェックボックス状態またはvisualPromptの指定のみに完全連動）
    const shouldGenerateImage = Boolean(requestVisualAid || visualPrompt);

    // 4. context.ts の buildAiYamatoContext を呼び出してシステムプロンプトを構築
    let baseSystemPrompt = buildAiYamatoContext({
      learningPace,
      userNickname,
      dialogueCount: chatHistory.length + 1,
      appType: "general"
    });

    // 英語応答の遵守指示と画像生成状況をシステムプロンプトに補強
    baseSystemPrompt += `\n\n<CRITICAL_LANGUAGE_AND_VISUAL_RULES>
- ABSOLUTE RULE: You MUST write your ENTIRE response strictly in ENGLISH. Japanese is ONLY permitted for target Japanese vocabulary, example sentences, kanji, furigana, or romaji.
- Do NOT reply in Japanese even if the user asks in Japanese. Explain Japanese concepts clearly in English.
- VISUAL AID STATUS: ${shouldGenerateImage ? "ENABLED. An educational visual diagram is being generated and attached to your response. Introduce it naturally in English (e.g., 'Here is a visual aid to help illustrate this concept!')." : "DISABLED"}
</CRITICAL_LANGUAGE_AND_VISUAL_RULES>`;

    // 5. 時間・天気のコンテキスト結合
    const enhancedSystemPromptText = await buildSystemInstructionWithTimeAndWeather(
      baseSystemPrompt,
      undefined,
      'melbourne'
    );

    const systemInstruction = {
      role: "system",
      parts: [{ text: enhancedSystemPromptText }]
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
      console.error(`Vertex AI API error (${vertexResponse.status}):`, errorText);
      throw new Error(`Vertex AI API error (${vertexResponse.status}): ${errorText}`);
    }

    const vertexData = await vertexResponse.json() as any;
    // 修正箇所: カテナリーの重複（?.?.）を正しいオプショナルチェーニングに修正
    const aiReply = vertexData?.candidates?.[0]?.content?.parts?.[0]?.text || "I'm sorry, I couldn't generate a response.";

    // 7. 画像生成の実行 (チェックボックスがONの場合にのみ実行)
    let imageUrl: string | undefined = undefined;
    let promptToUse = visualPrompt;

    if (!promptToUse && shouldGenerateImage) {
      promptToUse = `Educational instructional diagram and visual aid for Japanese language learners explaining: ${message}. Clean layout, high quality, professional illustration style.`;
    }

    if (promptToUse) {
      try {
        const base64Image = await generateVisualAid({
          promptText: promptToUse,
          projectId: projectId,
          location: region
        });
        if (base64Image) {
          imageUrl = `data:image/png;base64,${base64Image}`;
        }
      } catch (err: any) {
        console.error("Image Generation Error in chat.ts:", err.message);
      }
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
    console.error("Unhandled Exception in onRequestPost:", err.message, err.stack);
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