/**
 * @file index.ts
 * @description HonoベースのCloudflare Workers用APIサーバー（全9ペルソナ・画像生成・メタデータ配信・クレジット減算完全統合版）
 */

import { Hono } from 'hono';
import { buildAiYamatoContext } from './context';
import { buildConciergePrompt, defaultPortalContextData } from './concierge';
import { buildGameIgoPrompt } from './game-igo';
import { buildGenkoyoshiGeneralPrompt } from './genkoyoshi-editor-general';
import { buildVceGenkoyoshiPrompt, defaultVcePortalData } from './genkoyoshi-editor-vce';
import { buildEoyOralDrillPrompt } from './eoy-oral-drill';
import { buildEoyOralElaboratePrompt } from './eoy-oral-elaborate';
import { buildEoyOralMockPrompt } from './eoy-oral-mock';
import { buildEoyWritingPrompt } from './eoy-writing';
import { buildOralExamQuestionsPrompt } from './oral-exam-questions';

// 💡 画像生成サービスのインポート
import { generateVisualAid } from './imagen-service';

// 💡 FoundationLayout から最新のメタデータをインポート
import { FOUNDATION_LAYOUT_META } from './FoundationLayout';

// 💡 サーバーサイド用 Supabase 管理者クライアントおよびクレジット処理のインポート
import { getSupabaseAdmin, validateUserCredits, deductUserCredits } from './supabase-admin';
import { FeatureKey } from './credit-rules';

// 環境変数の型定義（柔軟なキー名に対応）
type Bindings = {
  VERTEX_AI_KEY?: string;
  GOOGLE_SERVICE_ACCOUNT_JSON?: string;
  VERTEX_AI_PROJECT_ID: string;
  VERTEX_AI_REGION?: string;
  SUPABASE_URL?: string;
  VITE_SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
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
  const exp = now + 3600; // 有効期限 1時間

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

// スキーマ配信用エンドポイント
app.get('/api/schema/:appType', (c) => {
  const appType = c.req.param('appType');
  let fields: string[] = [];

  switch (appType) {
    case 'genkoyoshi-editor-vce':
      fields = Object.keys(defaultVcePortalData);
      break;
    case 'concierge':
      fields = Object.keys(defaultPortalContextData);
      break;
    default:
      fields = [];
      break;
  }

  return c.json({ appType, fields });
});

// 💡 FoundationLayout.ts の FOUNDATION_LAYOUT_META を丸ごと配信するように修正
app.get('/api/ecosystem-metadata', (c) => {
  const metadata = {
    foundation: FOUNDATION_LAYOUT_META, // ← FoundationLayout.ts で定義した全プロパティ（currentSettings等を含む）がそのまま入ります
    apiCommon: {
      fileName: "YamatoApiCommon.tsx",
      layer: "窓口・外装",
      role: "共通プロンプト構造や portalData などの共通オプションを受け渡す基盤",
    },
    template: {
      fileName: "a-template.ts",
      layer: "乗組員 (ひな形)",
      role: "FoundationLayout のデータが内包されている YamatoApiCommon.tsx をインポートしてペルソナを記述するひな形",
    },
    portalLayout: {
      fileName: "PageLayout.tsx",
      layer: "土台 (機体)",
      role: "ポータル全体の共通レイアウト、ヘッダー/フッター、パスキー認証基盤",
    },
    chatCommon: {
      fileName: "YamatoChatCommon.tsx",
      layer: "窓口・外装",
      role: "対話UIの汎用テンプレート・操縦士コックピット",
    }
  };

  return c.json({
    success: true,
    metadata,
  });
});

// チャット送信用エンドポイント: POST /chat（画像生成・クレジット減算完全統合版）
app.post('/chat', async (c) => {
  try {
    const body = await c.req.json<{ 
      message: string; 
      chatHistory?: { role: string; content: string }[];
      history?: { role: string; content: string }[];
      assignedQuestion?: string;
      learningPace?: string;
      userNickname?: string;
      appType?: string;
      portalData?: any;
      faqList?: Array<any>;
      userId?: string;
      visualPrompt?: string;
      requestVisualAid?: boolean;
    }>();

    const userMessage = body.message;
    const history = body.chatHistory || body.history || [];
    const requestVisualAid = body.requestVisualAid || false;
    const visualPrompt = body.visualPrompt;

    if (!userMessage) {
      return c.json({ error: 'Message is required' }, 400);
    }

    // 💡 0. 未ログインガード
    if (!body.userId) {
      return c.json({ error: "Unauthorized", reply: "Authentication required to chat." }, 401);
    }

    // 環境変数のフォールバック取得
    const serviceAccountKey = c.env.VERTEX_AI_KEY || c.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    const projectId = c.env.VERTEX_AI_PROJECT_ID;
    const region = c.env.VERTEX_AI_REGION || "us-central1";

    if (!serviceAccountKey || !projectId) {
      console.error("❌ Configuration error: VERTEX_AI_KEY/GOOGLE_SERVICE_ACCOUNT_JSON or VERTEX_AI_PROJECT_ID is missing.");
      return c.json({ error: 'VERTEX_AI_KEY or VERTEX_AI_PROJECT_ID is not configured', reply: 'Server configuration error: AI keys are missing.' }, 500);
    }

    // 💡 1. 画像生成が含まれるリクエストかどうかを判定し、featureKey を決定
    const shouldGenerateImage = Boolean(requestVisualAid || visualPrompt);
    const featureKey: FeatureKey = shouldGenerateImage ? 'imageAi' : 'textAi';

    let supabaseAdmin: any = null;

    // 💡 2. サーバーサイドでのクレジット残高検証
    try {
      supabaseAdmin = getSupabaseAdmin(c.env);
      const { hasEnough, currentCredits, requiredCredits } = await validateUserCredits(supabaseAdmin, body.userId, featureKey);

      if (!hasEnough) {
        return c.json({
          reply: `Your current credit balance (${currentCredits} credits) is below the required amount (${requiredCredits} credits). Please top up or complete today's quiz!`,
          error: "Insufficient credits",
          required: requiredCredits,
          current: currentCredits
        }, 402);
      }
    } catch (dbErr: any) {
      console.error("❌ Database error during credit validation:", dbErr.message);
      return c.json({ error: "Database error during credit check", reply: "Failed to verify credit balance." }, 500);
    }

    // 💡 3. クレジットの事前減算処理
    if (supabaseAdmin && body.userId) {
      const deductResult = await deductUserCredits(supabaseAdmin, body.userId, featureKey);
      if (!deductResult.success) {
        console.warn("⚠️ Credit deduction failed:", deductResult.error);
        return c.json({ reply: "Failed to deduct credits. Please check your balance.", error: "Credit deduction failed" }, 402);
      }
    }

    // 4. サービスアカウントからアクセストークンを取得
    const accessToken = await getGoogleAccessToken(serviceAccountKey);

    // 5. システム指示の動的構築
    let systemInstructionText = "";
    const appType = body.appType || "general";
    
    const enrichedPortalData = {
      ...(body.portalData || {}),
      faqList: body.portalData?.faqList || body.faqList || []
    };

    const promptOptions: any = {
      userNickname: body.userNickname || "my friend",
      portalData: enrichedPortalData,
      faqList: enrichedPortalData.faqList,
      currentTurn: history.length + 1,
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
      case "oral-exam-questions":
        systemInstructionText = await buildOralExamQuestionsPrompt(promptOptions);
        break;
      default:
        systemInstructionText = buildAiYamatoContext({
          assignedQuestion: body.assignedQuestion || "",
          learningPace: body.learningPace || "normal",
          userNickname: body.userNickname || "生徒さん",
          appType: appType as any,
          dialogueCount: history.length + 1,
        });
        break;
    }

    // 6. Vertex AI 用の会話履歴データを構築
    const contents = [
      ...history.map((h) => ({
        role: h.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: h.content }]
      })),
      {
        role: 'user',
        parts: [{ text: userMessage }]
      }
    ];

    // 7. Vertex AI のエンドポイントへリクエスト送信
    const vertexUrl = `https://${region}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${region}/publishers/google/models/gemini-2.5-flash:generateContent`;

    const vertexRes = await fetch(vertexUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: systemInstructionText }]
        },
        contents
      })
    });

    if (!vertexRes.ok) {
      const errText = await vertexRes.text();
      return c.json({ error: `Vertex AI API Error: ${errText}` }, 500);
    }

    const data = (await vertexRes.json()) as any;
    const aiReply = data.candidates?.[0]?.content?.parts?.[0]?.text || '申し訳ありません。うまく理解できませんでした。';

    // 💡 8. 画像生成の実行（必要な場合）
    let imageUrl: string | undefined = undefined;
    let promptToUse = visualPrompt;

    if (!promptToUse && shouldGenerateImage) {
      promptToUse = `Educational instructional diagram and visual aid for Japanese language learners explaining: ${userMessage}. Clean layout, high quality, professional illustration style.`;
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
        console.error("❌ Image generation error in /chat:", err.message);
      }
    }

    return c.json({ 
      reply: aiReply,
      imageUrl: imageUrl 
    });

  } catch (e: any) {
    console.error("❌ Unhandled exception in /chat:", e.message, e.stack);
    return c.json({ error: e.message || 'Internal Server Error', reply: 'Sorry, an error occurred while processing your request.' }, 500);
  }
});

export default app;