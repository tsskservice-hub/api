/**
 * @file imagen-service.ts
 * @description Gemini 画像生成モデル (gemini-3.1-flash-lite-image) を使用した画像生成ユーティリティ（Remix・Cloudflare対応版）
 */

import { GoogleGenAI } from "@google/genai";

export interface GenerateVisualAidOptions {
  promptText: string;
  projectId?: string;
  location?: string;
  apiKey?: string;
}

/**
 * プロンプトから最新の Gemini 画像生成モデル (gemini-3.1-flash-lite-image) を使って画像を生成し、Base64形式で返す関数
 */
export async function generateVisualAid(
  promptTextOrOptions: string | GenerateVisualAidOptions
): Promise<string> {
  const options: GenerateVisualAidOptions =
    typeof promptTextOrOptions === "string"
      ? { promptText: promptTextOrOptions }
      : promptTextOrOptions;

  // 引数で渡された値、または環境変数（利用可能な場合）から取得
  const projectId =
    options.projectId ||
    (typeof process !== 'undefined' ? (process.env.VERTEX_AI_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT) : undefined);

  const location = options.location || "global";

  const apiKey =
    options.apiKey ||
    (typeof process !== 'undefined' ? (process.env.GEMINI_API_KEY || process.env.GOOGLE_GENAI_API_KEY) : undefined);

  let ai: GoogleGenAI;

  if (apiKey) {
    ai = new GoogleGenAI({ apiKey });
  } else if (projectId) {
    ai = new GoogleGenAI({
      enterprise: true,
      project: projectId,
      location: location,
    });
  } else {
    throw new Error(
      "Vertex AI の Project ID または API Key が設定されていません。"
    );
  }

  try {
    const modelName = "gemini-3.1-flash-lite-image";

    console.log(`[Imagen Service] Requesting content generation with image model: ${modelName} at location: ${location}`);

    // 最新仕様に準拠した generateContent による画像生成呼び出し
    const response = await ai.models.generateContent({
      model: modelName,
      contents: [
        {
          role: "user",
          parts: [{ text: options.promptText }],
        },
      ],
    });

    // レスポンスの候補（candidates）から画像パート（inlineData）を抽出
    const candidate = response.candidates?.[0];
    const parts = candidate?.content?.parts;

    if (!parts) {
      throw new Error("モデルからの応答パーツが取得できませんでした。");
    }

    let base64Image: string | undefined = undefined;

    for (const part of parts) {
      if (part.inlineData && part.inlineData.data) {
        base64Image = part.inlineData.data;
        break;
      }
    }

    if (!base64Image) {
      throw new Error("生成された画像データ（Base64）がレスポンスに含まれていませんでした。");
    }

    console.log("--- ✅ [Gemini Image Model] Image Generated Successfully ---");
    return base64Image;
  } catch (error: any) {
    console.error("Gemini Image Generation Error Detail:", error);
    throw error;
  }
}