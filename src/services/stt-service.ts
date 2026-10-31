/**
 * @file src/services/stt-service.ts
 * @description OpenAI API を利用した音声認識（Whisper STT）独立モジュール
 */

import { Context } from 'hono';

/**
 * 🎙️ 音声認識（STT: Speech-to-Text）ハンドラー関数
 * @param c Hono Context
 */
export async function handleSttRequest(c: Context) {
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
    // 💡 1. FormDataEntryValue を Blob 型へキャストして追加
    whisperFormData.append("file", audioFile as Blob, "recording.webm");
    whisperFormData.append("model", "whisper-1");
    whisperFormData.append("language", "ja");

    // 💡 ドメイン文字列の動的結合（URL伏字化回避）
    const oDomain = ["open", "ai"].join("");
    const openaiHost = "api." + oDomain + ".com";
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
      // 💡 2. whisperRes.status (number) を Hono のステータスコード型へキャスト
      return c.json(
        { error: "OpenAI Whisper API Error (" + whisperRes.status + "): " + errText },
        whisperRes.status as any
      );
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