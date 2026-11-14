/**
 * @file src/handlers/chat-handler.ts
 * @description カスケード型（Whisper STT ＋ Vertex AI Text LLM ＋ OpenAI TTS）の完全統合対話ハンドラー
 */

import { Context } from 'hono';
import { getGoogleAccessToken } from '../services/google-auth';
import { generateOpenAiTts } from '../services/tts-service';
import { generateVisualAid } from '../services/imagen-service';
import { dispatchSystemPrompt } from '../prompts/prompt-dispatcher';
import { reserveCredits, refundCredits, CreditReservation } from './credit-handler';
import { getSyncedKnowledge } from '../services/api-sync-knowledge';

/**
 * 🎙️ OpenAI Whisper API (STT) を用いて音声を日本語テキストに文字起こしする関数（堅牢版）
 */
async function transcribeAudioToText(audioBase64: string, openaiApiKey: string): Promise<string> {
  // 💡 どんな形式の Data URL プレフィックス（data:audio/...;base64,）でも確実に除去する
  let base64Data = audioBase64;
  if (base64Data.includes(',')) {
    base64Data = base64Data.split(',')[1];
  }
  // 空白や改行文字を除去してクリーンアップ
  base64Data = base64Data.replace(/[\r\n\s]/g, '');

  // Base64 からバイナリ（Uint8Array）に変換
  const binaryString = atob(base64Data);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: 'audio/webm' });

  // FormData の構築
  const formData = new FormData();
  formData.append('file', blob, 'user-recording.webm');
  formData.append('model', 'whisper-1');
  formData.append('language', 'ja'); // 💡 日本語に強制固定し、英語や外国語の混入を防止

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${openaiApiKey.trim()}`,
    },
    body: formData,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Whisper STT API Error (${res.status}): ${errText}`);
  }

  const data = (await res.json()) as any;
  return data.text || '';
}

export async function handleChatOrTtsRequest(c: Context) {
  // 💳 先払いしたクレジット（失敗時に返すために try の外で持つ）
  let reservation: CreditReservation | null = null;
  try {
    const body = (await c.req.json().catch(() => ({}))) as any;
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

    // 🔊 1. 単体 TTS リクエストの場合
    if (cleanedTtsText || isTtsEndpoint) {
      const textToSpeak = cleanedTtsText || body.message || "こんにちは";
      const openaiApiKey = c.env.OPENAI_API_KEY;

      if (!openaiApiKey) {
        return c.json({ error: "OPENAI_API_KEY is not configured on server environment variables." }, 500);
      }

      const voiceToUse = body.voice || "fable";
      const speedToUse = typeof body.speed === "number" ? body.speed : 1.0;
      const origin = c.req.header("Origin") || null;

      return await generateOpenAiTts(textToSpeak, openaiApiKey, voiceToUse, speedToUse, origin);
    }

    // 💬 2. フルカスケード型 AI チャット（音声入力 or テキスト入力 → STT → Vertex AI）処理
    // 🔐 ユーザーIDはログイン確認（requireAuth）で特定したものだけを使う
    const effectiveUserId: string = c.get('userId');
    const openaiApiKey = c.env.OPENAI_API_KEY;

    let userMessage = body.message;
    const audioBase64 = body.audioBase64 || body.audio; // フロントエンドから送られる音声データ

    // 💡 ダミーのプレースホルダーや空文字の場合は無効とし、音声データがある場合は Whisper STT を最優先で実行する
    if (userMessage === "(voice-audio-input)") {
      userMessage = undefined;
    }

    // 🎙️ 音声データが送信されてきた場合、まずは Whisper STT で日本語テキスト化する
    if (!userMessage && audioBase64) {
      if (!openaiApiKey) {
        return c.json({ error: 'OPENAI_API_KEY is required for audio transcription (STT).' }, 500);
      }
      try {
        userMessage = await transcribeAudioToText(audioBase64, openaiApiKey);
      } catch (sttErr: any) {
        console.error("❌ Whisper STT Error:", sttErr?.message || String(sttErr));
        return c.json({ error: `Audio transcription failed: ${sttErr?.message || 'Unknown error'}` }, 500);
      }
    }

    const history = body.chatHistory || body.history || [];

    const hasAnyQuestionImages =
      Boolean(body.questionImagesBase64 && body.questionImagesBase64.length > 0) ||
      Boolean(body.questionImageBase64);

    if (!userMessage && !audioBase64 && !body.imageBase64 && !hasAnyQuestionImages) {
      return c.json({ error: 'Message, audio, or image is required' }, 400);
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

    // 💳 AI を呼ぶ前にクレジットを引く（残高が足りるときだけ・同時リクエストでも二重使用できない）
    reservation = await reserveCredits(c, body, effectiveUserId);
    if (!reservation.ok) {
      return reservation.errorResponse!;
    }

    // 🔐 Google Access Token 取得
    const accessToken = await getGoogleAccessToken(serviceAccountKey);

    // 📜 システム指示プロンプトの構築（日本語厳守・JLPT統御プロンプトがここにディスパッチされます）
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
      await refundCredits(c.env, reservation);
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

    // 💡 履歴のロールとパーツ構造を厳密かつ安全にマッピング
    const contents = [
      ...history.map((h: any) => ({
        role: h.role === 'assistant' ? 'model' : 'user',
        parts: 'parts' in h && Array.isArray(h.parts) ? h.parts : [{ text: h.content || '' }],
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
      await refundCredits(c.env, reservation);
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

    // 🎨 画像生成AI処理
    if (promptToUse) {
      try {
        const base64Image = await generateVisualAid({
          promptText: promptToUse,
          projectId: projectId,
          location: "global",
          serviceAccountKey: serviceAccountKey,
        });
        if (base64Image) {
          imageUrl = base64Image;
        }
      } catch (err: any) {
        console.error("❌ Image generation error in /chat:", err?.message || String(err));
      }
    }

    // 📤 レスポンス返却（文字起こし結果 transcript も含めることでフロント側で確認可能）
    return c.json({ 
      reply: aiReply, 
      transcript: userMessage, // 💡 ユーザーの発話がどう文字起こしされたかを返す
      imageUrl: imageUrl,
      options: undefined 
    });
  } catch (e: any) {
    console.error("❌ [CHAT-HANDLER CRITICAL ERROR]:", e?.message || String(e));
    console.error("❌ [ERROR STACK]:", e?.stack);
    await refundCredits(c.env, reservation);
    
    return c.json(
      {
        error: e?.message || 'Internal Server Error',
        reply: `⚠️ Server Error: ${e?.message || 'Unknown error occurred'}`,
      },
      500
    );
  }
}

export default handleChatOrTtsRequest;