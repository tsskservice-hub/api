/**
 * @file src/index.ts
 * @description HonoベースのCloudflare Workers用メインAPIサーバー（完全モジュール分割・超軽量ルーティング版）
 */
import { Hono } from 'hono';
import { handleSttRequest } from './services/stt-service';
import { handleChatOrTtsRequest } from './handlers/chat-handler';
import { FOUNDATION_LAYOUT_META } from './FoundationLayout';
import { setSyncedKnowledge } from './api-sync-knowledge';

type Bindings = {
  VERTEX_AI_KEY?: string;
  GOOGLE_SERVICE_ACCOUNT_JSON?: string;
  VERTEX_AI_PROJECT_ID: string;
  VERTEX_AI_REGION?: string;
  SUPABASE_URL?: string;
  VITE_SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  SYNC_API_KEY?: string;
  AIYAMATO_SYSTEM_PROMPT?: string;
  OPENAI_API_KEY?: string;
  YAMATO_KNOWLEDGE?: KVNamespace;
};

const app = new Hono<{ Bindings: Bindings }>();

// 💡 CORS ミドルウェア設定
app.use('*', async (c, next) => {
  const origin = c.req.header('Origin') || '';
  const isAllowed =
    origin.endsWith('jptutoraiyamato.com') ||
    origin.endsWith('.pages.dev') ||
    origin.includes('pages.dev') ||
    origin.includes('localhost') ||
    origin.includes('127.0.0.1');
  const allowedOrigin = isAllowed ? origin : 'https://jptutoraiyamato.com';

  c.header('Access-Control-Allow-Origin', allowedOrigin);
  c.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  c.header('Access-Control-Allow-Credentials', 'true');

  if (c.req.method === 'OPTIONS') {
    return c.body(null, 204);
  }
  await next();
});

// 💡 ナレッジ一括同期エンドポイント
app.post('/api/sync-knowledge', async (c) => {
  const authHeader = c.req.header('Authorization');
  const expectedKey = c.env.SYNC_API_KEY;

  if (expectedKey && authHeader !== 'Bearer ' + expectedKey) {
    console.warn("⚠️ Unauthorized sync attempt detected.");
    return c.json({ success: false, error: 'Unauthorized: Invalid or missing API key' }, 401);
  }

  try {
    const body = (await c.req.json()) as any;
    if (typeof setSyncedKnowledge === 'function') {
      await setSyncedKnowledge(body, c.env);
    }
    return c.json({
      success: true,
      message: "Knowledge base synchronized successfully.",
      timestamp: new Date().toISOString()
    });
  } catch (err: any) {
    console.error("❌ Failed to sync knowledge:", err?.message || String(err));
    return c.json({ success: false, error: err?.message || String(err) }, 500);
  }
});

// 💡 スキーマ配信用エンドポイント
app.get('/api/schema/:appType', (c) => {
  const appType = c.req.param('appType');
  const fields = [
    'userNickname',
    'timeZone',
    'cityName',
    'studentEssay',
    'selectedTextType',
    'pace',
    'assignedQuestion',
    'writingSection'
  ];
  return c.json({ appType, fields });
});

// 💡 エコシステムメタデータ配信エンドポイント
app.get('/api/ecosystem-metadata', (c) => {
  return c.json({
    success: true,
    metadata: {
      foundation: FOUNDATION_LAYOUT_META,
    }
  });
});

// 💬 AIチャット ＆ 音声生成（TTS）ルーティング (chat-handler.ts へ委譲)
app.post('/chat', handleChatOrTtsRequest);
app.post('/api/chat', handleChatOrTtsRequest);
app.post('/api/test-tts', handleChatOrTtsRequest);

// 🎙️ 音声認識（STT）ルーティング (stt-service.ts へ委譲)
app.post('/api/test-stt', handleSttRequest);
app.post('/api/stt', handleSttRequest);

// 404 ハンドラー
app.notFound((c) => c.json({ error: 'Route Not Found' }, 404));

// グローバルエラーハンドラー
app.onError((err, c) => {
  console.error("❌ Unhandled Server Error:", err);
  return c.json({ error: err.message || 'Internal Server Error' }, 500);
});

export default app;