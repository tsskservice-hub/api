import { Hono } from 'hono';
import { buildAiYamatoContext } from './context';

// 環境変数の型定義
type Bindings = {
  VERTEX_AI_KEY: string;          // サービスアカウントのJSONキー全文
  VERTEX_AI_PROJECT_ID: string;   // Google Cloud プロジェクトID
  VERTEX_AI_REGION: string;       // リージョン (例: us-central1)
};

const app = new Hono<{ Bindings: Bindings }>();

// CORS設定（jptutoraiyamato.comおよび開発・プレビュー環境からのアクセスを安全に制御）
app.use('*', async (c, next) => {
  const origin = c.req.header('Origin') || '';

  // 許可するオリジンの判定条件
  // 1. jptutoraiyamato.com を含むドメイン (portal.jptutoraiyamato.com, jptutoraiyamato.com など)
  // 2. Cloudflare Pages等のプレビュー環境 (*.pages.dev)
  // 3. ローカル開発環境 (localhost または 127.0.0.1)
  const isAllowed = 
    origin.endsWith('jptutoraiyamato.com') ||
    origin.endsWith('.pages.dev') ||
    origin.includes('localhost') ||
    origin.includes('127.0.0.1');

  // 許可されたオリジンであればそのまま返し、なければ安全のためメインドメインを返す
  const allowedOrigin = isAllowed ? origin : 'https://jptutoraiyamato.com';

  c.header('Access-Control-Allow-Origin', allowedOrigin);
  c.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
  c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  c.header('Access-Control-Allow-Credentials', 'true');

  if (c.req.method === 'OPTIONS') {
    return c.body(null, 204);
  }
  await next();
});

/**
 * サービスアカウントのJSONキーとCrypto APIを使って、Google CloudのOAuth2アクセストークンを自前で取得する関数
 */
async function getGoogleAccessToken(serviceAccountJson: string): Promise<string> {
  let sa: any;
  try {
    sa = JSON.parse(serviceAccountJson);
  } catch (e: any) {
    // どんな文字列がVERTEX_AI_KEYに入ってきているのかをプレビュー付きでエラーにする
    const preview = typeof serviceAccountJson === 'string' 
      ? serviceAccountJson.slice(0, 50) 
      : String(serviceAccountJson);
    throw new Error(`VERTEX_AI_KEY JSON parse failed. Received preview: "${preview}" | Original error: ${e.message}`);
  }

  const privateKeyPem = sa.private_key;
  const clientEmail = sa.client_email;

  const now = Math.floor(Date.now() / 1000);
  const exp = now + 3600; // 有効期限 1時間

  // 1. JWT Header & Claim Set の作成
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

  // 2. PEM形式の秘密鍵をWeb Crypto APIで使えるようにパース
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

  // 3. 署名の生成 (RS256)
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsignedJwt)
  );

  const signatureBase64Url = base64UrlEncode(String.fromCharCode(...new Uint8Array(signature)));
  const jwt = `${unsignedJwt}.${signatureBase64Url}`;

  // 4. Google OAuth2 トークンエンドポイントへリクエスト
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`
  });

  if (!tokenRes.ok) {
    const errText = await tokenRes.text();
    throw new Error(`Failed to get Google Access Token: ${errText}`);
  }

  const tokenData = (await tokenRes.json()) as any;
  return tokenData.access_token;
}

// チャット送信用エンドポイント: POST /chat
app.post('/chat', async (c) => {
  try {
    const body = await c.req.json<{ 
      message: string; 
      history?: { role: string; content: string }[];
      assignedQuestion?: string;
      learningPace?: string;
      userNickname?: string;
      appType?: 'writing' | 'oral' | 'general';
    }>();

    const userMessage = body.message;
    const history = body.history || [];

    if (!userMessage) {
      return c.json({ error: 'Message is required' }, 400);
    }

    const serviceAccountKey = c.env.VERTEX_AI_KEY;
    const projectId = c.env.VERTEX_AI_PROJECT_ID;
    const region = c.env.VERTEX_AI_REGION || "us-central1";

    if (!serviceAccountKey || !projectId) {
      return c.json({ error: 'VERTEX_AI_KEY or VERTEX_AI_PROJECT_ID is not configured' }, 500);
    }

    // 1. サービスアカウントからアクセストークンを取得
    const accessToken = await getGoogleAccessToken(serviceAccountKey);

    // 2. context.ts の関数を使って、ヤマトのシステム指示（プロンプト）を動的に構築
    const systemInstructionText = buildAiYamatoContext({
      assignedQuestion: body.assignedQuestion || "",
      learningPace: body.learningPace || "normal",
      userNickname: body.userNickname || "生徒さん",
      appType: body.appType || "general",
      dialogueCount: history.length + 1,
    });

    // 3. Vertex AI 用の会話履歴データを構築
    const contents = [
      ...history.map((h) => ({
        role: h.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: h.content }]
      })),
      {
        role: 'user',
        parts: [{ text: userMessage }]
      }
    ];

    // 4. Vertex AI のエンドポイントへリクエスト送信
    const vertexUrl = `https://${region}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${region}/publishers/google/models/gemini-2.5-flash:generateContent`;

    const vertexRes = await fetch(vertexUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: systemInstructionText }]
        },
        contents
      })
    });

    if (!vertexRes.ok) {
      const errText = await vertexRes.text();
      return c.json({ error: `Vertex AI API Error: ${errText}` }, 500);
    }

    const data = (await vertexRes.json()) as any;
    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || '申し訳ありません。うまく理解できませんでした。';

    return c.json({ reply });

  } catch (e: any) {
    return c.json({ error: e.message || 'Internal Server Error' }, 500);
  }
});

export default app;