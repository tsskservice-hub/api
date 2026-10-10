import { Hono } from 'hono';
import { buildAiYamatoContext } from './context';

// 環境変数の型定義
type Bindings = {
  GEMINI_API_KEY: string;
};

const app = new Hono<{ Bindings: Bindings }>();

// CORS設定（jptutoraiyamato.comからのアクセスを許可する）
app.use('*', async (c, next) => {
  c.header('Access-Control-Allow-Origin', '*'); // 本番では 'https://jptutoraiyamato.com' に絞ると安全です
  c.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
  c.header('Access-Control-Allow-Headers', 'Content-Type');
  if (c.req.method === 'OPTIONS') {
    // ステータスコードの型エラーを防ぐため `c.body(null, 204)` に修正
    return c.body(null, 204);
  }
  await next();
});

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

    const apiKey = c.env.GEMINI_API_KEY;
    if (!apiKey) {
      return c.json({ error: 'API key is not configured' }, 500);
    }

    // context.ts の関数を使って、ヤマトのシステム指示（プロンプト）を動的に構築
    const systemInstructionText = buildAiYamatoContext({
      assignedQuestion: body.assignedQuestion || "",
      learningPace: body.learningPace || "normal",
      userNickname: body.userNickname || "生徒さん",
      appType: body.appType || "general",
      dialogueCount: history.length + 1,
    });

    // Gemini APIへのリクエストデータ構築
    const contents = [
      {
        role: 'user',
        parts: [{ text: `[System Instruction]\n${systemInstructionText}` }]
      },
      ...history.map((h) => ({
        role: h.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: h.content }]
      })),
      {
        role: 'user',
        parts: [{ text: userMessage }]
      }
    ];

    // Google Gemini API（例: gemini-2.5-flash）を呼び出し
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents })
      }
    );

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      return c.json({ error: `Gemini API Error: ${errText}` }, 500);
    }

    const data = (await geminiRes.json()) as any;
    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || '申し訳ありません。うまく理解できませんでした。';

    return c.json({ reply });

  } catch (e: any) {
    return c.json({ error: e.message || 'Internal Server Error' }, 500);
  }
});

export default app;