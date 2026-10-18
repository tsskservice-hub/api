/**
 * @file imagen-service.ts
 * @description Gemini 画像生成モデル (gemini-3.1-flash-lite-image) を使用した画像生成ユーティリティ（Cloudflare Workers完全対応版）
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

  // Cloudflare Workers または Node.js 環境のプロセス環境変数を安全に参照
  const envObj = typeof globalThis !== 'undefined' ? (globalThis as any).process?.env : undefined;

  const projectId =
    options.projectId ||
    envObj?.VERTEX_AI_PROJECT_ID || 
    envObj?.GOOGLE_CLOUD_PROJECT;

  const location = options.location || "us-central1";

  const apiKey =
    options.apiKey ||
    envObj?.GEMINI_API_KEY || 
    envObj?.GOOGLE_GENAI_API_KEY ||
    envObj?.VERTEX_AI_KEY;

  console.log("🔍 [imagen-service.ts] 初期化パラメータ確認:", {
    hasProjectId: Boolean(projectId),
    projectId: projectId ? `${projectId.slice(0, 5)}...` : undefined,
    location,
    hasApiKey: Boolean(apiKey),
    promptLength: options.promptText?.length
  });

  let ai: GoogleGenAI;

  try {
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

    const modelName = "gemini-3.1-flash-lite-image";

    console.log(`🚀 [imagen-service.ts] 画像生成モデルリクエスト開始: ${modelName} (location: ${location})`);

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

    console.log("📥 [imagen-service.ts] AIモデルからのレスポンスを受信しました。構造を解析します...");

    // レスポンスの候補（candidates）から画像パート（inlineData）を抽出
    const candidate = response.candidates?.[0];
    const parts = candidate?.content?.parts;

    if (!parts) {
      console.error("❌ [imagen-service.ts エラー] candidates または parts が存在しません。Response全文:", JSON.stringify(response));
      throw new Error("モデルからの応答パーツが取得できませんでした。");
    }

    let base64Image: string | undefined = undefined;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i] as any;
      // インライン画像のデータが含まれているかチェック (inlineData または inline_data に対応)
      const inlineData = part.inlineData || part.inline_data;
      if (inlineData && inlineData.data) {
        base64Image = inlineData.data;
        console.log(`✨ [imagen-service.ts] パーツ[${i}]で inlineData を検出しました (データ長: ${base64Image?.length})`);
        break;
      }
    }

    if (!base64Image) {
      console.error("❌ [imagen-service.ts エラー] レスポンスの各パーツに inlineData.data が見つかりませんでした。Parts:", JSON.stringify(parts));
      throw new Error("生成された画像データ（Base64）がレスポンスに含まれていませんでした。");
    }

    console.log("--- ✅ [Gemini Image Model] 画像の生成および抽出に完全に成功しました ---");
    return base64Image;
  } catch (error: any) {
    console.error("❌ [imagen-service.ts 例外発生]:", error.message || error);
    if (error.stack) {
      console.error("スタックトレース:", error.stack);
    }
    throw error;
  }
}