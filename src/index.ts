/**
 * @file index.ts
 * @description HonoベースのCloudflare Workers用APIサーバー（URL伏字修復・プロンプト未設定厳密エラー検知・OpenAI TTS/STT対応版）
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
import { buildKanjiGrammarCheckerVCEPrompt } from './kanji-grammar-checker-vce';
import { buildEoyWritingCustomPrompt } from './eoy-writing-custom';
import { buildImageExplanationYamatoPrompt } from './image-explanation';
import { generateVisualAid } from './imagen-service';
import { FOUNDATION_LAYOUT_META } from './FoundationLayout';
import { getSupabaseAdmin, validateUserCredits, deductUserCredits } from './supabase-admin';
import { determineRequiredCreditsFromPayload, FeatureKey, SERVER_CREDIT_COSTS } from './credit-rules';
import { getSyncedKnowledge, setSyncedKnowledge } from './api-sync-knowledge';

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
  OPENAI_API_KEY?: string;
  YAMATO_KNOWLEDGE?: KVNamespace;
};

const app = new Hono<{ Bindings: Bindings }>();

// CORS ミドルウェア設定
app.use('*', async (c, next) => {
  const origin = c.req.header('Origin') || '';
  const isAllowed =
    origin.endsWith('jptutoraiyamato.com') ||
    origin.endsWith('.pages.dev') ||
    origin.includes('pages.dev') ||
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
 * Google Access Token 取得関数
 */
async function getGoogleAccessToken(serviceAccountJson: string): Promise<string> {
  let sa: any;
  try {
    sa = JSON.parse(serviceAccountJson);
  } catch (e: any) {
    const preview =
      typeof serviceAccountJson === 'string' ? serviceAccountJson.slice(0, 50) : String(serviceAccountJson);
    throw new Error('Service Account JSON parse failed. Preview: ' + preview + ' | Error: ' + (e?.message || String(e)));
  }

  const privateKeyPem = sa.private_key;
  const clientEmail = sa.client_email;

  const now = Math.floor(Date.now() / 1000);
  const exp = now + 3600;

  const header = { alg: "RS256", typ: "JWT" };
  const tokenHost = "[suspicious link removed]";
  const claimSet = {
    iss: clientEmail,
    scope: "[suspicious link removed]",
    aud: "https://" + tokenHost + "/token",
    exp: exp,
    iat: now
  };

  const base64UrlEncode = (str: string) =>
    btoa(str).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const unsignedJwt =
    base64UrlEncode(JSON.stringify(header)) + "." + base64UrlEncode(JSON.stringify(claimSet));

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
  const jwt = unsignedJwt + "." + signatureBase64Url;

  const tokenEndpoint = "https://" + tokenHost + "/token";
  const tokenRes = await fetch(tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=" + jwt
  });

  if (!tokenRes.ok) {
    const errText = await tokenRes.text();
    throw new Error("Failed to get Google Access Token: " + errText);
  }

  const tokenData = (await tokenRes.json()) as any;
  return tokenData.access_token;
}

// ナレッジ一括同期エンドポイント
app.post('/api/sync-knowledge', async (c) => {
  const authHeader = c.req.header('Authorization');
  const expectedKey = c.env.SYNC_API_KEY;

  if (expectedKey && authHeader !== 'Bearer ' + expectedKey) {
    console.warn("⚠️ Unauthorized sync attempt detected.");
    return c.json({ success: false, error: 'Unauthorized: Invalid or missing API key' }, 401);
  }

  try {
    const body = (await c.req.json()) as any;
    if (typeof setSyncedKnowledge === 'function') {
      await setSyncedKnowledge(body, c.env);
    }
    return c.json({
      success: true,
      message: "Knowledge base synchronized successfully.",
      timestamp: new Date().toISOString()
    });
  } catch (err: any) {
    console.error("❌ Failed to sync knowledge:", err?.message || String(err));
    return c.json({ success: false, error: err?.message || String(err) }, 500);
  }
});

// スキーマ配信用エンドポイント
app.get('/api/schema/:appType', (c) => {
  const appType = c.req.param('appType');
  const fields = [
    'userNickname',
    'timeZone',
    'cityName',
    'studentEssay',
    'selectedTextType',
    'pace',
    'assignedQuestion',
    'writingSection'
  ];
  return c.json({ appType, fields });
});

// FoundationLayout メタデータ配信
app.get('/api/ecosystem-metadata', (c) => {
  const metadata = {
    foundation: FOUNDATION_LAYOUT_META,
    apiCommon: {
      fileName: "YamatoApiCommon.tsx",
      layer: "窓口・外装",
      role: "共通プロンプト構造や共通オプションを受け渡す基盤",
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
  return c.json({ success: true, metadata });
});

/**
 * 🎙️ 音声認識（STT: Speech-to-Text）ハンドラー関数
 */
async function handleSttRequest(c: any) {
  try {
    const origin = c.req.header('Origin') || '*';
    const openaiApiKey = c.env.OPENAI_API_KEY;

    if (!openaiApiKey) {
      console.error("❌ OPENAI_API_KEY is not configured.");
      return c.json({ error: "OPENAI_API_KEY is not configured on server environment variables." }, 500);
    }

    const formData = await c.req.formData();
    const audioFile = formData.get("audio") || formData.get("file") || formData.get("blob");

    if (!audioFile) {
      return c.json({ error: "No audio file provided in request FormData." }, 400);
    }

    const whisperFormData = new FormData();
    whisperFormData.append("file", audioFile, "recording.webm");
    whisperFormData.append("model", "whisper-1");
    whisperFormData.append("language", "ja");

    const openaiHost = "[suspicious link removed]";
    const whisperEndpoint = "https://" + openaiHost + "/v1/audio/transcriptions";

    const whisperRes = await fetch(whisperEndpoint, {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + openaiApiKey,
      },
      body: whisperFormData,
    });

    if (!whisperRes.ok) {
      const errText = await whisperRes.text();
      console.error("❌ OpenAI Whisper API Error:", whisperRes.status, errText);
      return c.json({ error: "OpenAI Whisper API Error (" + whisperRes.status + "): " + errText }, whisperRes.status);
    }

    const whisperData = (await whisperRes.json()) as any;
    const transcribedText = whisperData.text || "";

    console.log("✅ [Whisper STT] Transcribed successfully:", transcribedText);

    return c.json(
      { userText: transcribedText, text: transcribedText, success: true },
      200,
      {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Credentials": "true",
      }
    );
  } catch (err: any) {
    console.error("❌ Exception in STT Handler:", err);
    return c.json({ error: err?.message || "Internal STT Error" }, 500);
  }
}

/**
 * 💡 共通チャット ＆ 音声生成（OpenAI TTS）ハンドラー関数
 */
async function handleChatOrTtsRequest(c: any) {
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

    // 🔊 1. TTS テキストが存在する場合は OpenAI TTS (fable ボイス) で音声バイナリを生成
    if (cleanedTtsText || isTtsEndpoint) {
      const textToSpeak = cleanedTtsText || body.message || "こんにちは";
      console.log("🔊 [OpenAI TTS] Generating audio for: " + textToSpeak.slice(0, 30));
      const openaiApiKey = c.env.OPENAI_API_KEY;

      if (!openaiApiKey) {
        console.error("❌ OPENAI_API_KEY is not configured.");
        return c.json({ error: "OPENAI_API_KEY is not configured on server environment variables." }, 500);
      }

      const voiceToUse = body.voice || "fable";
      const speedToUse = typeof body.speed === "number" ? body.speed : 1.0;
      const openaiHost = "[suspicious link removed]";
      const openaiTtsEndpoint = "https://" + openaiHost + "/v1/audio/speech";

      const ttsResponse = await fetch(openaiTtsEndpoint, {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + openaiApiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "tts-1",
          input: textToSpeak,
          voice: voiceToUse,
          speed: speedToUse,
        }),
      });

      if (!ttsResponse.ok) {
        const errText = await ttsResponse.text();
        console.error("❌ OpenAI TTS API Error:", ttsResponse.status, errText);
        return c.json({ error: "OpenAI TTS API Error (" + ttsResponse.status + "): " + errText }, ttsResponse.status);
      }

      const audioBuffer = await ttsResponse.arrayBuffer();
      return new Response(audioBuffer, {
        status: 200,
        headers: {
          "Content-Type": "audio/mpeg",
          "Access-Control-Allow-Origin": c.req.header("Origin") || "*",
          "Access-Control-Allow-Credentials": "true",
        },
      });
    }

    // 💬 2. 通常の AI チャット（Gemini / Vertex AI）処理
    const effectiveUserId = body.userId || "test-guest-user";

    console.log("📥 Received /chat request:", {
      userId: effectiveUserId,
      appType: body.appType,
      isVoiceMode: body.isVoiceMode,
      writingSection: body.writingSection,
      messageLength: body.message?.length,
      hasAnswerImage: Boolean(body.imageBase64),
      questionImagesCount: body.questionImagesBase64?.length || (body.questionImageBase64 ? 1 : 0),
      assignedQuestion: body.assignedQuestion
    });

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
      console.error("❌ Configuration error: VERTEX_AI_KEY/GOOGLE_SERVICE_ACCOUNT_JSON or VERTEX_AI_PROJECT_ID is missing.");
      return c.json({
        error: 'VERTEX_AI_KEY or VERTEX_AI_PROJECT_ID is not configured',
        reply: 'Server configuration error: AI keys are missing.'
      }, 500);
    }

    // 必要クレジット数の自動判定
    const requiredCredits = determineRequiredCreditsFromPayload(body);

    const featureKey: FeatureKey = (body.featureKey && (body.featureKey in SERVER_CREDIT_COSTS))
      ? body.featureKey
      : requiredCredits >= 10
      ? 'mockFull'
      : requiredCredits === 6
      ? ( (body.isMockSection === "2" || body.appType === "eoy-oral-mock-section2") ? 'mockSection2' : (body.isMockSection === "1" || body.appType === "eoy-oral-mock-section1") ? 'mockSection1' : 'multiImageAi' )
      : (requiredCredits === 4 && (body.isVoiceMode === 'elaborate' || body.appType === 'eoy-oral-elaborate'))
      ? 'voiceElaborate'
      : requiredCredits === 4
      ? 'imageAi'
      : (requiredCredits === 3 && (body.isVoiceMode === 'drill' || body.appType === 'eoy-oral-drill'))
      ? 'voiceDrill'
      : 'textAi';

    let supabaseAdmin: any = null;
    try {
      supabaseAdmin = getSupabaseAdmin(c.env);
      if (supabaseAdmin) {
        console.log("🔍 [Supabase] Checking credits for user: " + effectiveUserId + ", Feature: " + featureKey + ", Required: " + requiredCredits);

        if (effectiveUserId !== "test-guest-user") {
          const creditCheck = await validateUserCredits(supabaseAdmin, effectiveUserId, featureKey);
          const { hasEnough, currentCredits } = creditCheck;

          if (!hasEnough) {
            if (currentCredits <= 0) {
              return c.json({
                error: "ZERO_CREDITS",
                message: "クレジットがゼロです。学習を継続するにはプランのアップグレードまたはクレジットの追加が必要です。",
                reply: "Your credit balance is 0. Please top up your credits to continue learning.",
                currentCredits,
                requiredCredits
              }, 402);
            }

            return c.json({
              error: "PARTIAL_SHORTAGE",
              message: "この機能には " + requiredCredits + " クレジット必要ですが、現在の残高は " + currentCredits + " クレジットです。",
              reply: "Insufficient credits. This action requires " + requiredCredits + " credits (you have " + currentCredits + ").",
              currentCredits,
              requiredCredits
            }, 402);
          }
        }
      }
    } catch (dbErr: any) {
      console.error("❌ [Supabase] Database check exception caught:", dbErr?.message || String(dbErr));
    }

    const accessToken = await getGoogleAccessToken(serviceAccountKey);

    // システム指示プロンプトの構築
    let systemInstructionText = "";
    const appType = body.appType || "general";
    const syncedKnowledge = await getSyncedKnowledge(c.env);

    const promptOptions: any = {
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

    switch (appType) {
      case "concierge":
        systemInstructionText = await buildConciergePrompt({ ...promptOptions, env: c.env });
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
      case "kanji-grammar-checker-vce":
        systemInstructionText = await buildKanjiGrammarCheckerVCEPrompt(promptOptions);
        break;
      case "eoy-oral-drill":
      case "eoy-oral-drill-chat":
        systemInstructionText = await buildEoyOralDrillPrompt(promptOptions);
        break;
      case "eoy-oral-elaborate":
      case "eoy-oral-elaborate-chat":
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
      case "oral-exam-questions":
        systemInstructionText = await buildOralExamQuestionsPrompt(promptOptions);
        break;
      case "image-explanation":
        systemInstructionText = await buildImageExplanationYamatoPrompt(promptOptions);
        break;
      default:
        if (body.systemPrompt) {
          systemInstructionText = body.systemPrompt;
        } else {
          console.error(`❌ Unregistered appType or missing prompt builder: '${appType}'`);
          return c.json(
            {
              error: "UNREGISTERED_APP_PROMPT",
              message: `専用プロンプトが未設定の appType です: '${appType}'。管理者へエラー報告してください。`,
              appType: appType,
            },
            400
          );
        }
        break;
    }

    // マルチモーダルパラメータ作成
    const userParts: any[] = [{ text: userMessage || "Please evaluate my answer against my question." }];

    if (body.questionImagesBase64 && Array.isArray(body.questionImagesBase64)) {
      for (const qImg of body.questionImagesBase64) {
        const qMatches = qImg.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
        if (qMatches && qMatches.length === 3) {
          userParts.push({ inline_data: { mime_type: qMatches, data: qMatches } });
        }
      }
    } else if (body.questionImageBase64) {
      const qMatches = body.questionImageBase64.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
      if (qMatches && qMatches.length === 3) {
        userParts.push({ inline_data: { mime_type: qMatches, data: qMatches } });
      }
    }

    if (body.imageBase64) {
      const aMatches = body.imageBase64.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
      if (aMatches && aMatches.length === 3) {
        userParts.push({ inline_data: { mime_type: aMatches, data: aMatches } });
      }
    }

    const contents = [
      ...history.map((h: any) => ({
        role: h.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: h.content }],
      })),
      { role: 'user', parts: userParts },
    ];

    const vertexHost = region + "-aiplatform.googleapis.com";
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

    if (promptToUse) {
      try {
        const base64Image = await generateVisualAid({
          promptText: promptToUse,
          projectId: projectId,
          location: region,
        });
        if (base64Image) {
          imageUrl = "data:image/png;base64," + base64Image;
        }
      } catch (err: any) {
        console.error("❌ Image generation error in /chat:", err?.message || String(err));
      }
    }

    // クレジット引き落としの実行
    if (supabaseAdmin && effectiveUserId !== "test-guest-user") {
      try {
        console.log(
          "💳 [Supabase] Deducting credits for user: " +
            effectiveUserId +
            ", Feature: " +
            featureKey +
            " (Cost: " +
            requiredCredits +
            ")"
        );
        await deductUserCredits(supabaseAdmin, effectiveUserId, featureKey);
      } catch (deductErr: any) {
        console.error("❌ [Supabase] Failed to deduct credits:", deductErr?.message || String(deductErr));
      }
    }

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

// ルーティング定義
app.post('/chat', handleChatOrTtsRequest);
app.post('/api/chat', handleChatOrTtsRequest);
app.post('/api/test-tts', handleChatOrTtsRequest);

// STT (Speech-to-Text) エンドポイント
app.post('/api/test-stt', handleSttRequest);
app.post('/api/stt', handleSttRequest);

// 404 ハンドラー
app.notFound((c) => {
  return c.json({ error: 'Route Not Found' }, 404);
});

// グローバルエラーハンドラー
app.onError((err, c) => {
  console.error("❌ Unhandled Server Error:", err);
  return c.json({ error: err.message || 'Internal Server Error' }, 500);
});

export default app;