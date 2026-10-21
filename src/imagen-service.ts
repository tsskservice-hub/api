/**
 * @file imagen-service.ts
 * @description Gemini 画像生成モデル (gemini-3.1-flash-lite-image) を使用した画像生成ユーティリティ（アクセストークン完全対応版）
 */

export interface GenerateVisualAidOptions {
  promptText: string;
  projectId?: string;
  location?: string;
  apiKey?: string;
}

/**
 * サービスアカウントのJSONキーを使って、Google CloudのOAuth2アクセストークンを自前で取得する関数
 */
async function getGoogleAccessToken(serviceAccountJson: string): Promise<string> {
  let sa: any;
  try {
    sa = JSON.parse(serviceAccountJson);
  } catch (e: any) {
    throw new Error(`Service Account JSON parse failed: ${e.message}`);
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
    throw new Error(`Failed to get Google Access Token for Image Generation: ${errText}`);
  }

  const tokenData = (await tokenRes.json()) as any;
  return tokenData.access_token;
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

  const envObj = typeof globalThis !== 'undefined' ? (globalThis as any).process?.env : undefined;

  const projectId =
    options.projectId ||
    envObj?.VERTEX_AI_PROJECT_ID || 
    envObj?.GOOGLE_CLOUD_PROJECT;

  const location = options.location || "global";

  const serviceAccountKey =
    envObj?.VERTEX_AI_KEY ||
    envObj?.GOOGLE_SERVICE_ACCOUNT_JSON;

  console.log("🎨 [imagen-service.ts] 画像生成パラメータ確認:", {
    hasProjectId: Boolean(projectId),
    location,
    hasServiceAccount: Boolean(serviceAccountKey),
    prompt: options.promptText
  });

  if (!projectId || !serviceAccountKey) {
    throw new Error("Vertex AI の Project ID または サービスアカウントキーが設定されていません。");
  }

  try {
    const accessToken = await getGoogleAccessToken(serviceAccountKey);
    const modelName = "gemini-3.1-flash-lite-image";

    // 💡 Vertex AI の generateContent エンドポイント（画像生成モデル対応）
    const vertexUrl = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${modelName}:generateContent`;

    console.log(`🚀 [imagen-service.ts] リクエスト送信先: ${vertexUrl}`);

    const response = await fetch(vertexUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: options.promptText }]
          }
        ]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("❌ [imagen-service.ts エラーレスポンス]:", errText);
      throw new Error(`Image Model API Error (${response.status}): ${errText}`);
    }

    const data = (await response.json()) as any;
    console.log("📥 [imagen-service.ts] レスポンス受信成功。データ解析中...");

    const candidate = data.candidates?.[0];
    const parts = candidate?.content?.parts;

    if (!parts || !Array.isArray(parts)) {
      throw new Error("モデルからの応答パーツ（parts）が取得できませんでした。");
    }

    let base64Image: string | undefined = undefined;

    for (const part of parts) {
      const inlineData = part.inlineData || part.inline_data;
      if (inlineData && inlineData.data) {
        base64Image = inlineData.data;
        break;
      }
      if (part.text && part.text.length > 100 && !part.text.includes(" ")) {
        base64Image = part.text.trim();
        break;
      }
    }

    if (!base64Image) {
      throw new Error("生成された画像データ（Base64）がレスポンスに含まれていませんでした。");
    }

    console.log("--- ✅ [Gemini Image Model] 画像の生成および抽出に完全に成功しました ---");
    return base64Image;

  } catch (error: any) {
    console.error("❌ [imagen-service.ts 例外発生]:", error.message || error);
    throw error;
  }
}