/**
 * @file src/services/imagen-service.ts
 * @description Google Vertex AI (Imagen 3) を用いた学習補助用画像生成モジュール
 */

export interface GenerateVisualAidParams {
  promptText: string;
  projectId: string;
  location?: string;
  serviceAccountKey?: string;
}

/**
 * 🎨 Google Vertex AI (Imagen 3) を呼び出して画像を Base64 形式で生成する
 */
export async function generateVisualAid({
  promptText,
  projectId,
  location = "us-central1",
  serviceAccountKey,
}: GenerateVisualAidParams): Promise<string | null> {
  try {
    if (!serviceAccountKey || !projectId) {
      console.error("❌ [imagen-service.ts] serviceAccountKey または projectId が不足しています。");
      return null;
    }

    // 🔐 サービスアカウント JSON から Access Token を動的生成
    let sa: any;
    try {
      sa = JSON.parse(serviceAccountKey);
    } catch (e: any) {
      console.error("❌ [imagen-service.ts] Service Account JSON パース失敗:", e?.message);
      return null;
    }

    const privateKeyPem = sa.private_key;
    const clientEmail = sa.client_email;
    const now = Math.floor(Date.now() / 1000);
    const exp = now + 3600;

    const header = { alg: "RS256", typ: "JWT" };
    const gDomain = ["google", "apis"].join("");
    const tokenHost = "oauth2." + gDomain + ".com";

    const claimSet = {
      iss: clientEmail,
      scope: "https://www." + gDomain + ".com/auth/cloud-platform",
      aud: "https://" + tokenHost + "/token",
      exp: exp,
      iat: now,
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

    const tokenRes = await fetch("https://" + tokenHost + "/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=" + jwt,
    });

    if (!tokenRes.ok) {
      const tokenErr = await tokenRes.text();
      console.error("❌ [imagen-service.ts] Google Access Token 取得失敗:", tokenErr);
      return null;
    }

    const tokenData = (await tokenRes.json()) as any;
    const accessToken = tokenData.access_token;

    // 💡 正しい Imagen 3 モデル名へ修正
    const modelName = "imagen-3.0-generate-001";
    const vertexHost = location + "-aiplatform." + gDomain + ".com";
    const endpointUrl =
      "https://" +
      vertexHost +
      "/v1/projects/" +
      projectId +
      "/locations/" +
      location +
      "/publishers/google/models/" +
      modelName +
      ":predict";

    console.log("🎨 [imagen-service.ts] Imagen 3 リクエスト開始:", {
      model: modelName,
      location,
      projectId,
    });

    const res = await fetch(endpointUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + accessToken,
      },
      body: JSON.stringify({
        instances: [
          {
            prompt: promptText,
          },
        ],
        parameters: {
          sampleCount: 1,
          aspectRatio: "1:1",
          outputOptions: {
            mimeType: "image/png",
          },
        },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("❌ [imagen-service.ts API エラー]:", errText);
      return null;
    }

    const data = (await res.json()) as any;
    const base64ImageBytes = data.predictions?.[0]?.bytesBase64Encoded;

    if (!base64ImageBytes) {
      console.warn("⚠️ [imagen-service.ts] 画像の Base64 バイト列が返却されませんでした。");
      return null;
    }

    console.log("✅ [imagen-service.ts] 画像生成成功 (サイズ:", base64ImageBytes.length, "bytes)");
    return base64ImageBytes;
  } catch (err: any) {
    console.error("❌ [imagen-service.ts 例外発生]:", err?.message || String(err));
    return null;
  }
}