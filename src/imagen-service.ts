import { GoogleGenAI } from "@google/genai";

export interface GenerateVisualAidOptions {
  promptText: string;
  projectId?: string;
  location?: string;
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

  const projectId =
    options.projectId ||
    process.env.VERTEX_AI_PROJECT_ID ||
    process.env.GOOGLE_CLOUD_PROJECT;

  // 💡 ドキュメントに従い、グローバルエンドポイント（または us-central1）を指定
  const location = options.location || "global";

  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENAI_API_KEY;

  let ai: GoogleGenAI;

  if (apiKey) {
    ai = new GoogleGenAI({ apiKey });
  } else if (projectId) {
    // 💡 enterprise: true と location: "global" を指定する最新の公式仕様に準拠
    ai = new GoogleGenAI({
      enterprise: true,
      project: projectId,
      location: location,
    });
  } else {
    throw new Error(
      "Vertex AI の Project ID (VERTEX_AI_PROJECT_ID) または API Key (GEMINI_API_KEY) が設定されていません。"
    );
  }

  try {
    // 💡 ドキュメントに記載されている最新の画像生成モデルIDを指定
    const modelName = "gemini-3.1-flash-lite-image";

    console.log(`[Imagen Service] Requesting content generation with image model: ${modelName} at location: ${location}`);

    // 💡 generateImages ではなく generateContent を使用する最新仕様
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

    // レスポンスに含まれる画像データ（inlineData または image bytes）を探す
    let base64Image: string | undefined = undefined;

    for (const part of parts) {
      // @google/genai の仕様によるインライン画像の取得
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
  } catch (error) {
    console.error("Gemini Image Generation Error Detail:", error);
    throw error;
  }
}