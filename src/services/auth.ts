/**
 * @file src/services/auth.ts
 * @description ログイン確認ミドルウェア
 *
 * ポータルから送られる `Authorization: Bearer <Supabaseのアクセストークン>` を
 * Supabase に問い合わせて検証し、本人のユーザーIDを c.get('userId') に入れる。
 * リクエスト本文の userId は一切信用しない。トークンがない・無効な場合は 401 を返す。
 */
import type { Context, Next } from 'hono';
import { getSupabaseAdmin } from './supabase-admin';

function loginRequired(c: Context) {
  return c.json(
    {
      error: 'LOGIN_REQUIRED',
      message: 'AIヤマトを使うにはログインが必要です。',
      reply: 'Please log in to use AI Yamato.',
    },
    401
  );
}

export async function requireAuth(c: Context, next: Next) {
  const header = c.req.header('Authorization') || '';
  const token = header.replace(/^Bearer\s+/i, '').trim();
  if (!token) return loginRequired(c);

  try {
    const admin = getSupabaseAdmin(c.env);
    const { data, error } = await admin.auth.getUser(token);
    if (error || !data?.user) return loginRequired(c);
    c.set('userId', data.user.id);
  } catch (err: any) {
    // 認証を確認できないときは、通さない（安全側に倒す）
    console.error('❌ [auth] Token verification failed:', err?.message || String(err));
    return c.json(
      {
        error: 'AUTH_UNAVAILABLE',
        message: 'ログイン状態を確認できませんでした。しばらくしてからもう一度お試しください。',
        reply: 'We could not verify your login. Please try again later.',
      },
      503
    );
  }

  await next();
}
