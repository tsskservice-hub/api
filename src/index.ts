/**
 * @file src/index.ts
 * @description HonoベースのCloudflare Workers用メインAPIサーバー（クレジット加算・クイズ報酬・リアルタイム音声対応版）
 */
import { Hono } from 'hono';
import { handleSttRequest } from './services/stt-service';
import { handleChatOrTtsRequest } from './handlers/chat-handler';
import { handleRealtimeSessionRequest } from './handlers/realtime-audio-handler';
import { FOUNDATION_LAYOUT_META } from './FoundationLayout';
import { setSyncedKnowledge } from './services/api-sync-knowledge';
import { requireAuth } from './services/auth';
import { getAllowedOrigin } from './services/cors';
import { handleWritingStatusRequest, handleWritingPostRequest } from './handlers/textbook-lesson-writing-handler';

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

const app = new Hono<{ Bindings: Bindings; Variables: { userId: string } }>();

// 💡 CORS ミドルウェア設定（許可リストは services/cors.ts。完全一致・正規表現で判定）
app.use('*', async (c, next) => {
  const allowedOrigin = getAllowedOrigin(c.req.header('Origin'));

  c.header('Vary', 'Origin');
  if (allowedOrigin) {
    c.header('Access-Control-Allow-Origin', allowedOrigin);
    c.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    c.header('Access-Control-Allow-Credentials', 'true');
  }

  if (c.req.method === 'OPTIONS') {
    return c.body(null, 204);
  }
  await next();
});

// 🔐 ログイン必須のエンドポイント（AI・音声機能はすべてログインした人だけが使える）
// ユーザーIDはアクセストークンから特定し、c.get('userId') で受け取る。body.userId は使わない。
for (const path of ['/chat', '/api/chat', '/api/test-tts', '/api/stt', '/api/test-stt', '/api/realtime/session', '/api/textbook-lesson-writing']) {
  app.use(path, requireAuth);
}

// 💡 ナレッジ一括同期エンドポイント
app.post('/api/sync-knowledge', async (c) => {
  const authHeader = c.req.header('Authorization');
  const expectedKey = c.env.SYNC_API_KEY;

  // SYNC_API_KEY が未設定の場合も拒否する（未設定だと誰でも書き込めてしまうため）
  if (!expectedKey || authHeader !== 'Bearer ' + expectedKey) {
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

// ※ /api/credits/charge と /api/quiz/submit は、だれでもクレジットを増やせてしまうため削除した。
//   クレジットの加算は Stripe Webhook（ポータル側）でのみ行う。

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

// 🎙️ リアルタイム音声セッション（OpenAI Realtime API）発行用エンドポイント
app.post('/api/realtime/session', handleRealtimeSessionRequest);

// ✍️ 教科書準拠レッスンのライティング課題（textbook-lesson-writing-handler.ts へ委譲）
// GET: 課題と提出状況 / POST: 画像の読み取り（intent: "read"）・フィードバック（intent: "feedback"）
app.get('/api/textbook-lesson-writing', handleWritingStatusRequest);
app.post('/api/textbook-lesson-writing', handleWritingPostRequest);

// 404 ハンドラー
app.notFound((c) => c.json({ error: 'Route Not Found' }, 404));

// グローバルエラーハンドラー
app.onError((err, c) => {
  console.error("❌ Unhandled Server Error:", err);
  return c.json({ error: err.message || 'Internal Server Error' }, 500);
});

export default app;