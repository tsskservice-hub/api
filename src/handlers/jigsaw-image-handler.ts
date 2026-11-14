/**
 * @file src/handlers/jigsaw-image-handler.ts
 * @description クラスのライブゲーム「みんなでジグソー」の写真（一覧・アップロード）
 *
 * GET  /api/live-game/jigsaw/images   先生が使える写真（サイトの写真集＋自分がアップロードした写真）
 * POST /api/live-game/jigsaw/images   先生が写真をアップロードする（multipart: file, title, credit, rights=yes, width, height）
 *
 * 写真は Storage の live-jigsaw バケット（ファイル名はランダム）。表は edu_jigsaw_images（25_class_jigsaw.sql）。
 * 先生がアップロードした写真は、その先生だけが使える。サイトの写真集へは SQL（tool_jigsaw_library.sql）で移す。
 */
import type { Context } from 'hono';
import { getSupabaseAdmin } from '../services/supabase-admin';

export const JIGSAW_BUCKET = 'live-jigsaw';
const MAX_BYTES = 5 * 1024 * 1024;
const TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export function jigsawImageUrl(env: any, path: string) {
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

export async function handleJigsawImageUpload(c: Context) {
  const { userId, admin, isTeacher } = await requireTeacher(c);
  if (!isTeacher) return c.json({ error: 'TEACHER_ONLY' }, 403);

  let form: Record<string, any>;
  try {
    form = await c.req.parseBody();
  } catch {
    return c.json({ error: 'BAD_REQUEST' }, 400);
  }
  const file = form.file;
  const title = String(form.title ?? '').trim().replace(/\s+/g, ' ');
  const credit = String(form.credit ?? '').trim().replace(/\s+/g, ' ');
  const width = Number(form.width);
  const height = Number(form.height);

  // 権利の確認（「この画像を使う権利があります」）がないものは受け付けない
  if (form.rights !== 'yes') return c.json({ error: 'RIGHTS_REQUIRED', message: 'Please confirm you have the right to use this image.' }, 400);
  if (!(file instanceof File)) return c.json({ error: 'NO_FILE' }, 400);
  const ext = TYPES[file.type];
  if (!ext) return c.json({ error: 'BAD_TYPE', message: 'Please upload a JPEG, PNG or WebP image.' }, 400);
  if (file.size > MAX_BYTES) return c.json({ error: 'TOO_LARGE', message: 'Images must be 5 MB or smaller.' }, 400);
  if (!title || title.length > 100) return c.json({ error: 'BAD_TITLE', message: 'Title must be 1–100 characters.' }, 400);
  if (credit.length > 200) return c.json({ error: 'BAD_CREDIT', message: 'Credit must be 200 characters or fewer.' }, 400);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 200 || height < 200 || width > 10000 || height > 10000) {
    return c.json({ error: 'BAD_SIZE', message: 'The image must be at least 200 × 200 pixels.' }, 400);
  }

  const path = `images/${crypto.randomUUID()}.${ext}`;
  const { error: uploadError } = await admin.storage
    .from(JIGSAW_BUCKET)
    .upload(path, await file.arrayBuffer(), { contentType: file.type, upsert: false });
  if (uploadError) {
    console.error('❌ [jigsaw] upload failed:', uploadError.message);
    return c.json({ error: 'UPLOAD_FAILED' }, 500);
  }

  const { data: row, error } = await admin
    .from('edu_jigsaw_images')
    .insert({ teacher_id: userId, title, credit: credit || null, storage_path: path, width, height })
    .select('id, title, credit, storage_path, width, height')
    .single();
  if (error || !row) {
    console.error('❌ [jigsaw] insert failed:', error?.message);
    await admin.storage.from(JIGSAW_BUCKET).remove([path]);
    return c.json({ error: 'UPLOAD_FAILED' }, 500);
  }
  return c.json({
    image: { id: row.id, title: row.title, credit: row.credit, url: jigsawImageUrl(c.env, row.storage_path), width: row.width, height: row.height, mine: true },
  });
}
