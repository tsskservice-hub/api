/**
 * @file imagen-service.ts
 * @description Vertex AI Imagen / Gemini 画像生成モデルを使用したビジュアルエイド生成ユーティリティ（完全堅牢化版）
 */

import { GoogleGenAI } from "@google/genai";

export interface GenerateVisualAidOptions {
  promptText: string;
  projectId?: string;
  location?: string;
  apiKey?: string;
}

/**
 * プロンプトから画像を生成し、Base64形式（image/png）で返す関数
 */
export async function generateVisualAid(
  promptTextOrOptions: string | GenerateVisualAidOptions
): Promise<string> {
  const options: GenerateVisualAidOptions =
    typeof promptTextOrOptions === "string"
      ? { promptText: promptTextOrOptions }
      : promptTextOrOptions;

  const envObj = typeof globalThis !== 'undefined' ? (globalThis as any).process?.env : undefined;

  const projectId =
    options.projectId ||
    envObj?.VERTEX_AI_PROJECT_ID || 
    envObj?.GOOGLE_CLOUD_PROJECT;

  const location = options.location || envObj?.VERTEX_AI_REGION || "us-central1";

  const apiKey =
    options.apiKey ||
    envObj?.GEMINI_API_KEY || 
    envObj?.GOOGLE_GENAI_API_KEY ||
    envObj?.VERTEX_AI_KEY;

  console.log("🎨 [imagen-service.ts] 画像生成リクエスト開始:", {
    projectId: projectId ? `${projectId.slice(0, 5)}...` : "none",
    location,
    prompt: options.promptText
  });

  try {
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
      throw new Error("Vertex AI の Project ID または API Key が設定されていません。");
    }

    // 💡 画像生成用のモデル名を指定（環境に合わせて調整可能）
    const modelName = "gemini-3.1-flash-lite-image"; 

    // GoogleGenAI SDK を用いた画像生成リクエスト
    const response = await ai.models.generateContent({
      model: modelName,
      contents: [
        {
          role: "user",
          parts: [{ text: options.promptText }],
        },
      ],
    });

    console.log("📥 [imagen-service.ts] AIモデルからのレスポンスを受信しました。");

    const candidate = response.candidates?.[0];
    const parts = candidate?.content?.parts;

    if (!parts || !Array.isArray(parts)) {
      console.error("❌ [imagen-service.ts エラー] candidates または parts が存在しません。Response:", JSON.stringify(response));
      throw new Error("モデルからの応答パーツが取得できませんでした。");
    }

    let base64Image: string | undefined = undefined;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i] as any;
      
      // 1. inlineData / inline_data からの抽出
      const inlineData = part.inlineData || part.inline_data;
      if (inlineData && inlineData.data) {
        base64Image = inlineData.data;
        console.log(`✨ [imagen-service.ts] パーツ[${i}]で inlineData を検出しました (長軸: ${base64Image?.length})`);
        break;
      }

      // 2. テキストとしてBase64が返ってきている場合やその他のフォールバック
      if (part.text && part.text.length > 100 && !part.text.includes(" ")) {
        base64Image = part.text.trim();
        console.log(`✨ [imagen-service.ts] パーツ[${i}]のテキストからBase64データを検出しました`);
        break;
      }
    }

    if (!base64Image) {
      console.error("❌ [imagen-service.ts エラー] 有効な画像データ（Base64）が見つかりませんでした。Parts:", JSON.stringify(parts));
      throw new Error("生成された画像データがレスポンスに含まれていませんでした。");
    }

    return base64Image;

  } catch (error: any) {
    console.error("❌ [imagen-service.ts 例外発生]:", error.message || error);
    if (error.stack) {
      console.error("スタックトレース:", error.stack);
    }
    throw error;
  }
}