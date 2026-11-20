/**
 * @file src/handlers/jigsaw-image-handler.ts
 * @description クラスのライブゲーム「みんなでジグソー」の写真（一覧・アップロード）
 *
 * GET  /api/live-game/jigsaw/images   先生が使える写真（サイトの写真集＋以前に自分がアップロードした写真）
 * POST /api/live-game/jigsaw/images/delete   先生が以前に自分でアップロードした写真を消す（JSON: { id }）
 *
 * 2026-11-21: 先生による写真のアップロードは止めた（個人情報が写った写真が公開バケットに入るのを防ぐため）。
 *   使える写真はサイトの写真集（浮世絵など。ポータルの public/live-game/jigsaw/）だけ。
 *   要望があれば、非公開バケット＋期限付き URL で作り直すことを検討する。
 * 表は edu_jigsaw_images（25_class_jigsaw.sql）。live-jigsaw バケットは、以前のアップロードを消すためだけに残している。
 */
import type { Context } from 'hono';
import { getSupabaseAdmin } from '../services/supabase-admin';

export const JIGSAW_BUCKET = 'live-jigsaw';

export function jigsawImageUrl(env: any, path: string) {
  // サイトの写真集のうち、ポータルの public に置いた絵（浮世絵など。scripts/pack-jigsaw.py）はそのままの場所を使う
  if (path.startsWith('/live-game/jigsaw/')) return path;
  const base = String(env?.SUPABASE_URL || env?.VITE_SUPABASE_URL || '').replace(/\/$/, '');
  return `${base}/storage/v1/object/public/${JIGSAW_BUCKET}/${path}`;
}

async function requireTeacher(c: Context) {
  const userId = c.get('userId') as string;
  const admin = getSupabaseAdmin(c.env);
  const { data: profile } = await admin.from('profiles').select('is_teacher').eq('id', userId).maybeSingle();
  return { userId, admin, isTeacher: Boolean(profile?.is_teacher) };
}

export async function handleJigsawImageList(c: Context) {
  const { userId, admin, isTeacher } = await requireTeacher(c);
  if (!isTeacher) return c.json({ error: 'TEACHER_ONLY' }, 403);
  const { data, error } = await admin
    .from('edu_jigsaw_images')
    .select('id, teacher_id, title, credit, storage_path, width, height, created_at')
    .or(`teacher_id.is.null,teacher_id.eq.${userId}`)
    .order('created_at', { ascending: false });
  if (error) {
    console.error('❌ [jigsaw] list failed:', error.message);
    return c.json({ error: 'LIST_FAILED' }, 500);
  }
  return c.json({
    images: (data ?? []).map((r: any) => ({
      id: r.id,
      title: r.title,
      credit: r.credit,
      url: jigsawImageUrl(c.env, r.storage_path),
      width: r.width,
      height: r.height,
      mine: r.teacher_id === userId,
    })),
  });
}

/**
 * 先生が自分でアップロードした写真を消す（サイトの写真集の写真は消せない）。
 * 表の記録を消すと、データベースのトリガーが写真の場所を削除待ちリストに入れる（31_class_jigsaw_image_cleanup.sql）。
 * ここではファイルもすぐに消し、リストからも外す。失敗しても、毎日の処理（handwriting-cleanup.ts）が消す。
 */
export async function handleJigsawImageDelete(c: Context) {
  const { userId, admin, isTeacher } = await requireTeacher(c);
  if (!isTeacher) return c.json({ error: 'TEACHER_ONLY' }, 403);
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'BAD_REQUEST' }, 400);
  }
  const id = String(body?.id ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) return c.json({ error: 'BAD_REQUEST' }, 400);

  const { data: image } = await admin
    .from('edu_jigsaw_images')
    .select('id, teacher_id, storage_path')
    .eq('id', id)
    .maybeSingle();
  if (!image || image.teacher_id !== userId) return c.json({ error: 'NOT_FOUND' }, 404);

  // 今まさにこの写真で遊んでいる（または始まる前の）ゲームがあるときは消さない
  const { data: active } = await admin
    .from('edu_live_games')
    .select('id')
    .eq('jigsaw_image_id', id)
    .in('status', ['lobby', 'running'])
    .limit(1);
  if (active && active.length) {
    return c.json({ error: 'IN_USE', message: 'This picture is being used in a game that is still open. End that game first.' }, 409);
  }

  const { error } = await admin.from('edu_jigsaw_images').delete().eq('id', id).eq('teacher_id', userId);
  if (error) {
    console.error('❌ [jigsaw] delete failed:', error.message);
    return c.json({ error: 'DELETE_FAILED' }, 500);
  }
  const { error: removeError } = await admin.storage.from(JIGSAW_BUCKET).remove([image.storage_path]);
  if (removeError) {
    console.error('❌ [jigsaw] file delete failed (the daily cleanup will retry):', removeError.message);
  } else {
    await admin.from('edu_image_deletion_queue').delete().eq('path', image.storage_path);
  }
  return c.json({ ok: true });
}
