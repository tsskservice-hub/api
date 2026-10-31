/**
 * @file src/services/imagen-service.ts
 * @description Gemini 3.1 Flash Lite Image (Global エンドポイント) による画像生成ユーティリティ
 */

export interface GenerateVisualAidOptions {
  promptText: string;
  projectId?: string;
  location?: string;
  serviceAccountKey?: string;
}

export async function generateVisualAid(
  options: GenerateVisualAidOptions
): Promise<string | null> {
  const projectId = options.projectId;
  // 💡 Gemini 3.1 Flash Lite Image は "global" リージョンで呼び出します
  const location = options.location || "us-central1";
  const serviceAccountKey = options.serviceAccountKey;

  if (!projectId || !serviceAccountKey) {
    console.error("❌ [imagen-service.ts] projectId または serviceAccountKey が不足しています。");
    return null;
  }

  try {
    // 🔐 Google Access Token 取得
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
      const errText = await tokenRes.text();
      console.error("❌ [imagen-service.ts] Access Token 取得失敗:", errText);
      return null;
    }

    const tokenData = (await tokenRes.json()) as any;
    const accessToken = tokenData.access_token;

    const modelName = "gemini-3.1-flash-lite-image";

    // 💡 location が "global" の場合は aiplatform.googleapis.com を直接指定
    const vertexUrl =
      location === "global"
        ? `https://aiplatform.googleapis.com/v1/projects/${projectId}/locations/global/publishers/google/models/${modelName}:generateContent`
        : `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${modelName}:generateContent`;

    console.log(`🚀 [imagen-service.ts] 送信先URL: ${vertexUrl}`);

    const response = await fetch(vertexUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        contents: {
          role: "user",
          parts: {
            text: options.promptText,
          },
        },
        generation_config: {
          response_modalities: ["TEXT", "IMAGE"],
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("❌ [imagen-service.ts エラーレスポンス]:", errText);
      return null;
    }

    const data = (await response.json()) as any;
    const candidate = data.candidates?.[0];
    const parts = candidate?.content?.parts;

    if (!parts) {
      console.error("❌ レスポンスに parts が含まれません:", JSON.stringify(data));
      return null;
    }

    let base64Image: string | undefined = undefined;
    const partsArray = Array.isArray(parts) ? parts : [parts];

    for (const part of partsArray) {
      const inlineData = part.inlineData || part.inline_data;
      if (inlineData && inlineData.data) {
        base64Image = inlineData.data;
        break;
      }
      if (part.text && part.text.length > 200 && !part.text.includes(" ")) {
        base64Image = part.text.trim();
        break;
      }
    }

    if (!base64Image) {
      console.error("❌ 応答パーツに画像データが見つかりませんでした。");
      return null;
    }

    console.log("✅ [Gemini 3.1 Flash Lite Image] 画像の抽出に成功しました");
    return base64Image;
  } catch (err: any) {
    console.error("❌ [imagen-service.ts 例外発生]:", err?.message || String(err));
    return null;
  }
}