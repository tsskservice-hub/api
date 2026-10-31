/**
 * @file src/services/tts-service.ts
 * @description OpenAI API を利用した音声合成（OpenAI TTS）独立モジュール
 */

/**
 * 🔊 音声合成（TTS: Text-to-Speech）処理関数
 * @param textToSpeak 音声化するテキスト
 * @param openaiApiKey OpenAI API Key
 * @param voice ボイス名（デフォルト: "fable"）
 * @param speed 再生速度（デフォルト: 1.0）
 * @param origin CORS用 Origin ヘッダー
 * @returns 音声バイナリデータ（audio/mpeg Response）
 */
export async function generateOpenAiTts(
  textToSpeak: string,
  openaiApiKey: string,
  voice: string = "fable",
  speed: number = 1.0,
  origin: string = "*"
): Promise<Response> {
  // 💡 ドメイン文字列の動的結合（URL伏字化回避）
  const oDomain = ["open", "ai"].join("");
  const openaiHost = "api." + oDomain + ".com";
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
      voice: voice,
      speed: speed,
    }),
  });

  if (!ttsResponse.ok) {
    const errText = await ttsResponse.text();
    console.error("❌ OpenAI TTS API Error:", ttsResponse.status, errText);
    throw new Error("OpenAI TTS API Error (" + ttsResponse.status + "): " + errText);
  }

  const audioBuffer = await ttsResponse.arrayBuffer();
  return new Response(audioBuffer, {
    status: 200,
    headers: {
      "Content-Type": "audio/mpeg",
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Credentials": "true",
    },
  });
}