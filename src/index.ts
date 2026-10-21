/**
 * @file index.ts
 * @description HonoベースのCloudflare Workers用APIサーバー（絵で説明ヤマト対応・Visual Aid連携・クレジット堅牢化版）
 */

import { Hono } from 'hono';
import { buildAiYamatoContext } from './context';
import { buildConciergePrompt } from './concierge';
import { buildGameIgoPrompt } from './game-igo';
import { buildGenkoyoshiGeneralPrompt } from './genkoyoshi-editor-general';
import { buildVceGenkoyoshiPrompt } from './genkoyoshi-editor-vce';
import { buildEoyOralDrillPrompt } from './eoy-oral-drill';
import { buildEoyOralElaboratePrompt } from './eoy-oral-elaborate';
import { buildEoyOralMockPrompt } from './eoy-oral-mock';
import { buildEoyWritingPrompt } from './eoy-writing';
import { buildOralExamQuestionsPrompt } from './oral-exam-questions';

// 💡 カスタムライティング用頭脳（eoy-writing-custom.ts）のインポート
import { buildEoyWritingCustomPrompt } from './eoy-writing-custom';

// 💡 画像・日本文化解説特化「絵で説明ヤマト」のインポート
import { buildImageExplanationYamatoPrompt } from './image-explanation';

// 💡 画像生成サービスのインポート
import { generateVisualAid } from './imagen-service';

// 💡 FoundationLayout から最新のメタデータをインポート
import { FOUNDATION_LAYOUT_META } from './FoundationLayout';

// 💡 サーバーサイド用 Supabase 管理者クライアントおよびクレジット処理・ルール関数のインポート
import { getSupabaseAdmin, validateUserCredits, deductUserCredits } from './supabase-admin';
import { determineRequiredCreditsFromPayload, FeatureKey } from './credit-rules';

// 💡 yamato-portal から同期されたナレッジデータを Cloudflare KV 経由で管理するモジュールのインポート
import { getSyncedKnowledge, setSyncedKnowledge } from './api-sync-knowledge';

// 環境変数の型定義
type Bindings = {
  VERTEX_AI_KEY?: string;
  GOOGLE_SERVICE_ACCOUNT_JSON?: string;
  VERTEX_AI_PROJECT_ID: string;
  VERTEX_AI_REGION?: string;
  SUPABASE_URL?: string;
  VITE_SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  SYNC_API_KEY?: string;
  AIYAMATO_SYSTEM_PROMPT?: string;
  YAMATO_KNOWLEDGE: KVNamespace;
};

const app = new Hono<{ Bindings: Bindings }>();

// CORS設定
app.use('*', async (c, next) => {
  const origin = c.req.header('Origin') || '';

  const isAllowed = 
    origin.endsWith('jptutoraiyamato.com') ||
    origin.endsWith('.pages.dev') ||
    origin.includes('localhost') ||
    origin.includes('127.0.0.1');

  const allowedOrigin = isAllowed ? origin : 'https://jptutoraiyamato.com';

  c.header('Access-Control-Allow-Origin', allowedOrigin);
  c.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  c.header('Access-Control-Allow-Credentials', 'true');

  if (c.req.method === 'OPTIONS') {
    return c.body(null, 204);
  }
  await next();
});

/**
 * サービスアカウントのJSONキーとCrypto APIを使って、Google CloudのOAuth2アクセストークンを自前で取得する関数
 */
async function getGoogleAccessToken(serviceAccountJson: string): Promise<string> {
  let sa: any;
  try {
    sa = JSON.parse(serviceAccountJson);
  } catch (e: any) {
    const preview = typeof serviceAccountJson === 'string' 
      ? serviceAccountJson.slice(0, 50) 
      : String(serviceAccountJson);
    throw new Error(`Service Account JSON parse failed. Received preview: "${preview}" | Original error: ${e.message}`);
  }

  const privateKeyPem = sa.private_key;
  const clientEmail = sa.client_email;

  const now = Math.floor(Date.now() / 1000);
  const exp = now + 3600;

  const header = { alg: "RS256", typ: "JWT" };
  const claimSet = {
    iss: clientEmail,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: "https://oauth2.googleapis.com/token",
    exp: exp,
    iat: now
  };

  const base64UrlEncode = (str: string) => 
    btoa(str).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

  const unsignedJwt = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(claimSet))}`;

  const pemHeader = "-----BEGIN PRIVATE KEY-----";
  const pemFooter = "-----END PRIVATE KEY-----";
  let pemContents = privateKeyPem.replace(pemHeader, "").replace(pemFooter, "").replace(/\s/g, "");
  const binaryDerString = atob(pemContents);
  const binaryDer = new Uint8Array(binaryDerString.length);
  for (let i = 0; i < binaryDerString.length; i++) {
    binaryDer[i] = binaryDerString.charCodeAt(i);
  }

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
    new TextEncoder().encode(unsignedJwt)
  );

  const signatureBase64Url = base64UrlEncode(String.fromCharCode(...new Uint8Array(signature)));
  const jwt = `${unsignedJwt}.${signatureBase64Url}`;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`
  });

  if (!tokenRes.ok) {
    const errText = await tokenRes.text();
    throw new Error(`Failed to get Google Access Token: ${errText}`);
  }

  const tokenData = (await tokenRes.json()) as any;
  return tokenData.access_token;
}

// ナレッジ同期エンドポイント
app.post('/api/sync-knowledge', async (c) => {
  const authHeader = c.req.header('Authorization');
  const expectedKey = c.env.SYNC_API_KEY;

  if (expectedKey && authHeader !== `Bearer ${expectedKey}`) {
    console.warn("⚠️ Unauthorized sync attempt detected.");
    return c.json({ success: false, error: 'Unauthorized: Invalid or missing API key' }, 401);
  }

  try {
    const body = await c.req.json<any>();
    await setSyncedKnowledge(body, c.env);

    return c.json({ 
      success: true, 
      message: "Knowledge base synchronized and saved to KV successfully.",
      timestamp: new Date().toISOString()
    });
  } catch (err: any) {
    console.error("❌ Failed to sync knowledge to KV:", err.message);
    return c.json({ success: false, error: err.message }, 500);
  }
});

app.get('/api/schema/:appType', (c) => {
  const appType = c.req.param('appType');
  const fields = ['userNickname', 'timeZone', 'cityName', 'studentEssay', 'selectedTextType', 'pace', 'assignedQuestion', 'writingSection'];
  return c.json({ appType, fields });
});

app.get('/api/ecosystem-metadata', (c) => {
  const metadata = {
    foundation: FOUNDATION_LAYOUT_META,
    apiCommon: { fileName: "YamatoApiCommon.tsx", layer: "窓口・外装", role: "共通プロンプト構造" },
    template: { fileName: "a-template.ts", layer: "乗組員", role: "ペルソナ記述ひな形" },
    portalLayout: { fileName: "PageLayout.tsx", layer: "土台", role: "共通レイアウト・認証基盤" },
    chatCommon: { fileName: "YamatoChatCommon.tsx", layer: "窓口", role: "対話UIウィジェット" }
  };

  return c.json({ success: true, metadata });
});

// チャット送信用エンドポイント: POST /chat
app.post('/chat', async (c) => {
  try {
    const body = await c.req.json<{ 
      message: string; 
      chatHistory?: { role: string; content: string }[];
      history?: { role: string; content: string }[];
      assignedQuestion?: string;
      questionImageBase64?: string;        
      questionImagesBase64?: string[];     
      learningPace?: string;
      userNickname?: string;
      appType?: string;
      userId?: string;
      visualPrompt?: string;
      requestVisualAid?: boolean;
      imageBase64?: string; 
      featureKey?: FeatureKey;
      isMockFull?: boolean;
      isMockSection?: "1" | "2";
      isVoiceMode?: "drill" | "elaborate";
      pace?: string;
      selectedTextType?: string;
      studentEssay?: string;
      exactCharacterCount?: number;
      writingSection?: "section2b" | "section3" | "other";
      timeZone?: string;
      cityName?: string;
      systemPrompt?: string;
    }>();

    const effectiveUserId = body.userId || "test-guest-user";

    console.log("📥 Received /chat request:", {
      userId: effectiveUserId,
      appType: body.appType,
      messageLength: body.message?.length,
      hasAnswerImage: Boolean(body.imageBase64),
      requestVisualAid: body.requestVisualAid
    });

    const userMessage = body.message;
    const history = body.chatHistory || body.history || [];
    const hasAnyQuestionImages = Boolean(body.questionImagesBase64 && body.questionImagesBase64.length > 0) || Boolean(body.questionImageBase64);

    if (!userMessage && !body.imageBase64 && !hasAnyQuestionImages) {
      return c.json({ error: 'Message or image is required' }, 400);
    }

    const serviceAccountKey = c.env.VERTEX_AI_KEY || c.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    const projectId = c.env.VERTEX_AI_PROJECT_ID;
    const region = c.env.VERTEX_AI_REGION || "us-central1";

    if (!serviceAccountKey || !projectId) {
      console.error("❌ Configuration error: VERTEX_AI_KEY/GOOGLE_SERVICE_ACCOUNT_JSON or VERTEX_AI_PROJECT_ID is missing.");
      return c.json({ error: 'VERTEX_AI_KEY or VERTEX_AI_PROJECT_ID is not configured', reply: 'Server configuration error: AI keys are missing.' }, 500);
    }

    // 💡 Visual Aid チェックがONの場合は強制的に 4 クレジット（imageAi）として計算・処理
    const isVisualAidRequested = Boolean(body.requestVisualAid);
    const baseRequiredCredits = determineRequiredCreditsFromPayload(body);
    const requiredCredits = isVisualAidRequested ? Math.max(baseRequiredCredits, 4) : baseRequiredCredits;

    const featureKey: FeatureKey = requiredCredits >= 10 ? 'mockFull' 
      : requiredCredits === 6 ? 'mockSection1' 
      : requiredCredits === 4 && (body.isVoiceMode === 'elaborate' || body.appType === 'eoy-oral-elaborate') ? 'voiceElaborate'
      : requiredCredits === 4 ? 'imageAi' 
      : requiredCredits === 3 ? 'voiceDrill' 
      : 'textAi';

    let supabaseAdmin: any = null;

    try {
      supabaseAdmin = getSupabaseAdmin(c.env);
      if (supabaseAdmin && effectiveUserId !== "test-guest-user") {
        const creditCheck = await validateUserCredits(supabaseAdmin, effectiveUserId, featureKey);
        const { hasEnough, currentCredits } = creditCheck;

        if (!hasEnough) {
          if (currentCredits <= 0) {
            return c.json({
              error: "ZERO_CREDITS",
              message: "クレジットがゼロです。学習を継続するにはクレジットの追加が必要です。",
              reply: "Your credit balance is 0. Please top up your credits to continue learning.",
              currentCredits,
              requiredCredits
            }, 402);
          }

          return c.json({
            error: "PARTIAL_SHORTAGE",
            message: `この機能には ${requiredCredits} クレジット必要ですが、現在の残高は ${currentCredits} クレジットです。`,
            reply: `Insufficient credits. This action requires ${requiredCredits} credits (you have ${currentCredits}).`,
            currentCredits,
            requiredCredits
          }, 402);
        }
      }
    } catch (dbErr: any) {
      console.error("❌ [Supabase] Database check exception caught:", dbErr.message);
    }

    const accessToken = await getGoogleAccessToken(serviceAccountKey);

    // システム指示の構築
    let systemInstructionText = "";
    const appType = body.appType || "general";
    const syncedKnowledge = await getSyncedKnowledge(c.env);
    const basePromptOverride = body.systemPrompt || c.env.AIYAMATO_SYSTEM_PROMPT || "";

    const promptOptions: any = {
      userNickname: body.userNickname || "my friend",
      faqList: syncedKnowledge.faqList || [],
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

    switch (appType) {
      case "concierge":
        systemInstructionText = await buildConciergePrompt(promptOptions);
        break;
      case "game-igo":
        systemInstructionText = await buildGameIgoPrompt(promptOptions);
        break;
      case "genkoyoshi-editor-general":
        systemInstructionText = await buildGenkoyoshiGeneralPrompt(promptOptions);
        break;
      case "genkoyoshi-editor-vce":
        systemInstructionText = await buildVceGenkoyoshiPrompt(promptOptions);
        break;
      case "eoy-oral-drill":
        systemInstructionText = await buildEoyOralDrillPrompt(promptOptions);
        break;
      case "eoy-oral-elaborate":
        systemInstructionText = await buildEoyOralElaboratePrompt(promptOptions);
        break;
      case "eoy-oral-mock":
        systemInstructionText = await buildEoyOralMockPrompt(promptOptions);
        break;
      case "eoy-writing":
        systemInstructionText = await buildEoyWritingPrompt(promptOptions);
        break;
      case "eoy-writing-custom":
      case "custom":
        systemInstructionText = await buildEoyWritingCustomPrompt(promptOptions);
        break;
      case "image-explanation":
        systemInstructionText = await buildImageExplanationYamatoPrompt(promptOptions);
        break;
      case "oral-exam-questions":
        systemInstructionText = await buildOralExamQuestionsPrompt(promptOptions);
        break;
      default:
        systemInstructionText = basePromptOverride || buildAiYamatoContext({
          assignedQuestion: body.assignedQuestion || "",
          learningPace: body.learningPace || "normal",
          userNickname: body.userNickname || "生徒さん",
          appType: appType as any,
          dialogueCount: history.length + 1,
        });
        break;
    }

    // マルチモーダル対応
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
      ...history.map((h) => ({
        role: h.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: h.content }]
      })),
      { role: 'user', parts: userParts }
    ];

    const vertexUrl = `https://${region}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${region}/publishers/google/models/gemini-2.5-flash:generateContent`;

    const vertexRes = await fetch(vertexUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemInstructionText }] },
        contents
      })
    });

    if (!vertexRes.ok) {
      const errText = await vertexRes.text();
      console.error("❌ Vertex AI API Error:", errText);
      return c.json({ error: `Vertex AI API Error: ${errText}` }, 500);
    }

    const data = (await vertexRes.json()) as any;
    const aiReply = data.candidates?.[0]?.content?.parts?.[0]?.text || '申し訳ありません。うまく理解できませんでした。';

    // 💡 Visual Aid (画像生成) の実行処理（serviceAccountKey を明示的に渡す）
    let imageUrl: string | undefined = undefined;
    let promptToUse = body.visualPrompt;
    const shouldGenerateImage = Boolean(isVisualAidRequested || body.visualPrompt || requiredCredits === 4);

    if (!promptToUse && shouldGenerateImage) {
      promptToUse = `Educational instructional diagram and visual aid for Japanese language learners explaining: ${userMessage}. Clean layout, high quality, professional illustration style.`;
    }

    if (promptToUse) {
      try {
        console.log("🎨 [Backend] Generating visual aid with prompt:", promptToUse);
        const base64Image = await generateVisualAid({
          promptText: promptToUse,
          projectId: projectId,
          location: "global",
          serviceAccountKey: serviceAccountKey
        });
        if (base64Image) {
          imageUrl = `data:image/png;base64,${base64Image}`;
          console.log("✨ [Backend] Visual aid generated successfully, length:", base64Image.length);
        }
      } catch (err: any) {
        console.error("❌ Image generation error in /chat:", err.message);
      }
    }

    // クレジット控除処理
    if (supabaseAdmin && effectiveUserId !== "test-guest-user") {
      try {
        await deductUserCredits(supabaseAdmin, effectiveUserId, featureKey);
        console.log("✅ [Supabase] Credits deducted successfully for feature:", featureKey);
      } catch (deductErr: any) {
        console.error("❌ [Supabase] Failed to deduct credits:", deductErr.message);
      }
    }

    return c.json({ 
      reply: aiReply,
      imageUrl: imageUrl 
    });

  } catch (e: any) {
    console.error("❌ Unhandled exception in /chat:", e.message);
    return c.json({ error: e.message || 'Internal Server Error', reply: 'Sorry, an error occurred while processing your request.' }, 500);
  }
});

export default app;