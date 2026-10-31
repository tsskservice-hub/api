/**
 * @file src/services/google-auth.ts
 * @description Google Service Account JSON から Web Crypto API を用いて JWT を署名・生成し、Google OAuth2 Access Token を取得する独立モジュール
 */

/**
 * Google Service Account JSON から Access Token を取得する
 * @param serviceAccountJson Google Service Account の JSON 文字列
 * @returns Google Cloud Platform アクセストークン
 */
export async function getGoogleAccessToken(serviceAccountJson: string): Promise<string> {
  let sa: any;
  try {
    sa = JSON.parse(serviceAccountJson);
  } catch (e: any) {
    const preview =
      typeof serviceAccountJson === 'string' ? serviceAccountJson.slice(0, 50) : String(serviceAccountJson);
    throw new Error('Service Account JSON parse failed. Preview: ' + preview + ' | Error: ' + (e?.message || String(e)));
  }

  const privateKeyPem = sa.private_key;
  const clientEmail = sa.client_email;

  if (!privateKeyPem || !clientEmail) {
    throw new Error('Invalid Service Account JSON: Missing private_key or client_email');
  }

  const now = Math.floor(Date.now() / 1000);
  const exp = now + 3600;

  const header = { alg: "RS256", typ: "JWT" };

  // 💡 ドメイン文字列の動的結合（Cloudflare Workers環境でのURL安全化・伏字化回避）
  const gDomain = ["google", "apis"].join("");
  const tokenHost = "oauth2." + gDomain + ".com";
  
  const claimSet = {
    iss: clientEmail,
    scope: "https://www." + gDomain + ".com/auth/cloud-platform",
    aud: "https://" + tokenHost + "/token",
    exp: exp,
    iat: now
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

  const tokenEndpoint = "https://" + tokenHost + "/token";
  const tokenRes = await fetch(tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=" + jwt
  });

  if (!tokenRes.ok) {
    const errText = await tokenRes.text();
    throw new Error("Failed to get Google Access Token: " + errText);
  }

  const tokenData = (await tokenRes.json()) as any;
  return tokenData.access_token;
}