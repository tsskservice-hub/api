/**
 * @file src/handlers/live-game-handler.ts
 * @description クラスのライブゲーム（Class Live Game）の入口
 *
 * POST /api/live-game/create   先生が自分のクラスの部屋を作る（requireAuth）
 * GET  /api/live-game/mine     いま参加できる部屋を返す。先生には自分のクラスの一覧も返す（requireAuth）
 * GET  /api/live-game/:id/ws   部屋への WebSocket（本人確認は部屋の中で、最初のメッセージのトークンで行う）
 *
 * 参加コードはない。生徒は「自分が入っているクラス」の部屋にだけ入れる。
 */
import type { Context } from 'hono';
import { getSupabaseAdmin } from '../services/supabase-admin';
import { getAllowedOrigin } from '../services/cors';
import type { RoomConfig, JigsawPieceInput } from '../live-game/room';
import { jigsawImageUrl } from './jigsaw-image-handler';
import type { QuestionSet } from '../live-game/content';

const QUESTION_SETS: QuestionSet[] = ['hiragana', 'katakana', 'kanji'];
/** これより古い「開始前」の部屋は、もう使われていないとみなす */
const LOBBY_STALE_MS = 3 * 60 * 60_000;
/** ジグソーのピースの数と、たて・よこの数（横長の写真。縦長なら入れ替える） */
const JIGSAW_GRIDS: Record<number, [number, number]> = { 24: [6, 4], 48: [8, 6], 80: [10, 8] };
/** ピース 1 つの画像（data URL）の大きさの上限 */
const PIECE_MAX_CHARS = 600_000;
const PIECE_DATA_RE = /^data:image\/(png|webp);base64,[A-Za-z0-9+/=]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function roomStub(env: any, gameId: string) {
  const ns = env.LIVE_GAME as DurableObjectNamespace;
  return ns.get(ns.idFromName(gameId)) as any;
}

function isFresh(game: { status: string; created_at: string }) {
  if (game.status === 'running') return true;
  return Date.now() - new Date(game.created_at).getTime() < LOBBY_STALE_MS;
}

export async function handleLiveGameCreate(c: Context) {
  const userId = c.get('userId') as string;
  const admin = getSupabaseAdmin(c.env);

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'BAD_REQUEST' }, 400);
  }
  const classId = String(body?.classId ?? '');
  const questionSet = body?.questionSet as QuestionSet;
  const durationMin = Number(body?.durationMin);
  const nameMode = body?.nameMode === 'preset' ? 'preset' : body?.nameMode === 'free' ? 'free' : null;
  if (!UUID_RE.test(classId) || !QUESTION_SETS.includes(questionSet) || !nameMode) {
    return c.json({ error: 'BAD_REQUEST' }, 400);
  }
  if (!Number.isInteger(durationMin) || durationMin < 1 || durationMin > 15) {
    return c.json({ error: 'BAD_DURATION', message: 'Time must be 1–15 minutes.' }, 400);
  }
  const mode: 'coins' | 'jigsaw' = body?.mode === 'jigsaw' ? 'jigsaw' : 'coins';

  // みんなでジグソー：先生のブラウザが切り分けたピースを受け取る（どこに入るかはサーバーだけが持つ）
  let pieces: JigsawPieceInput[] = [];
  let cols = 0;
  let rows = 0;
  let imageId = '';
  if (mode === 'jigsaw') {
    imageId = String(body?.imageId ?? '');
    const pieceCount = Number(body?.pieceCount);
    cols = Number(body?.cols);
    rows = Number(body?.rows);
    const grid = JIGSAW_GRIDS[pieceCount];
    const gridOk = grid && ((cols === grid[0] && rows === grid[1]) || (cols === grid[1] && rows === grid[0]));
    if (!UUID_RE.test(imageId) || !gridOk || !Array.isArray(body?.pieces) || body.pieces.length !== pieceCount) {
      return c.json({ error: 'BAD_JIGSAW' }, 400);
    }
    const seen = new Set<number>();
    for (const p of body.pieces) {
      const slot = Number(p?.slot);
      const data = String(p?.data ?? '');
      if (!Number.isInteger(slot) || slot < 0 || slot >= pieceCount || seen.has(slot)) return c.json({ error: 'BAD_JIGSAW' }, 400);
      if (data.length > PIECE_MAX_CHARS || !PIECE_DATA_RE.test(data)) return c.json({ error: 'BAD_PIECE' }, 400);
      seen.add(slot);
      pieces.push({ slot, data });
    }
  }

  // 承認済みの先生で、そのクラスの担任か
  const { data: profile } = await admin.from('profiles').select('is_teacher').eq('id', userId).maybeSingle();
  if (!profile?.is_teacher) return c.json({ error: 'TEACHER_ONLY' }, 403);
  const { data: cls } = await admin
    .from('edu_classes')
    .select('id, name, teacher_id')
    .eq('id', classId)
    .maybeSingle();
  if (!cls || cls.teacher_id !== userId) return c.json({ error: 'NOT_YOUR_CLASS' }, 403);

  // ジグソーの写真は、サイトの写真集か、自分がアップロードしたものだけ
  let jigsaw: RoomConfig['jigsaw'] = null;
  if (mode === 'jigsaw') {
    const { data: image } = await admin
      .from('edu_jigsaw_images')
      .select('id, teacher_id, title, credit, storage_path, width, height')
      .eq('id', imageId)
      .maybeSingle();
    if (!image || (image.teacher_id && image.teacher_id !== userId)) return c.json({ error: 'IMAGE_NOT_FOUND' }, 404);
    jigsaw = {
      imageUrl: jigsawImageUrl(c.env, image.storage_path),
      width: image.width,
      height: image.height,
      cols,
      rows,
      title: image.title,
      credit: image.credit ?? null,
    };
  }

  // 同じクラスの古い部屋は閉じる（1 クラスに部屋は 1 つ）
  const { data: active } = await admin
    .from('edu_live_games')
    .select('id')
    .eq('class_id', classId)
    .in('status', ['lobby', 'running']);
  for (const g of active ?? []) {
    try {
      await roomStub(c.env, g.id).cancel();
    } catch (err: any) {
      console.error('❌ [live-game] cancel failed:', err?.message || String(err));
    }
    await admin.from('edu_live_games').update({ status: 'cancelled', ended_at: new Date().toISOString() }).eq('id', g.id);
  }

  const { data: game, error } = await admin
    .from('edu_live_games')
    .insert({
      class_id: classId,
      teacher_id: userId,
      question_set: questionSet,
      duration_sec: durationMin * 60,
      name_mode: nameMode,
      mode,
      jigsaw_image_id: mode === 'jigsaw' ? imageId : null,
      piece_count: mode === 'jigsaw' ? pieces.length : null,
    })
    .select('id')
    .single();
  if (error || !game) {
    console.error('❌ [live-game] create failed:', error?.message);
    return c.json({ error: 'CREATE_FAILED' }, 500);
  }

  const config: RoomConfig = {
    gameId: game.id,
    classId,
    className: cls.name,
    teacherId: userId,
    questionSet,
    durationSec: durationMin * 60,
    nameMode,
    mode,
    // ジグソーは協力して遊ぶので、対戦の仕組み（じゃんけん・早押し・ヤマトの問題）は使わない
    janken: mode === 'coins' && body?.janken !== false,
    speed: mode === 'coins' && body?.speed !== false,
    yamato: mode === 'coins' && body?.yamato !== false,
    jigsaw,
  };
  const result = await roomStub(c.env, game.id).init(config, pieces);
  if (!result?.ok) {
    await admin.from('edu_live_games').update({ status: 'cancelled' }).eq('id', game.id);
    return c.json({ error: result?.error || 'CREATE_FAILED', message: 'Could not load the questions for this game.' }, 500);
  }
  return c.json({ gameId: game.id });
}

export async function handleLiveGameMine(c: Context) {
  const userId = c.get('userId') as string;
  const admin = getSupabaseAdmin(c.env);

  const { data: profile } = await admin.from('profiles').select('is_teacher').eq('id', userId).maybeSingle();

  if (profile?.is_teacher) {
    const { data: classes } = await admin
      .from('edu_classes')
      .select('id, name')
      .eq('teacher_id', userId)
      .order('created_at', { ascending: true });
    const classIds = (classes ?? []).map((cl: any) => cl.id);
    const { data: games } = classIds.length
      ? await admin
          .from('edu_live_games')
          .select('id, class_id, status, created_at')
          .in('class_id', classIds)
          .in('status', ['lobby', 'running'])
      : { data: [] as any[] };
    return c.json({
      role: 'teacher',
      classes: (classes ?? []).map((cl: any) => {
        const game = (games ?? []).find((g: any) => g.class_id === cl.id && isFresh(g));
        return { id: cl.id, name: cl.name, activeGameId: game?.id ?? null };
      }),
    });
  }

  const { data: memberships } = await admin
    .from('edu_class_members')
    .select('class_id')
    .eq('user_id', userId)
    .eq('role', 'student');
  const classIds = (memberships ?? []).map((m: any) => m.class_id);
  if (!classIds.length) return c.json({ role: 'student', inClass: false, game: null });

  const { data: games } = await admin
    .from('edu_live_games')
    .select('id, class_id, status, created_at')
    .in('class_id', classIds)
    .in('status', ['lobby', 'running'])
    .order('created_at', { ascending: false });
  const game = (games ?? []).find(isFresh);
  return c.json({ role: 'student', inClass: true, game: game ? { id: game.id, status: game.status } : null });
}

/** Hono を通さずに WebSocket を部屋へ渡す（101 応答のヘッダーをいじらないため） */
export function matchLiveGameSocket(request: Request): string | null {
  const m = new URL(request.url).pathname.match(/^\/api\/live-game\/([0-9a-f-]{36})\/ws$/);
  return m && UUID_RE.test(m[1]) ? m[1] : null;
}

export async function handleLiveGameSocket(request: Request, env: any, gameId: string): Promise<Response> {
  if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
    return new Response('Expected WebSocket', { status: 426 });
  }
  // このサイト以外のページからはつながせない
  if (!getAllowedOrigin(request.headers.get('Origin'))) {
    return new Response('Forbidden', { status: 403 });
  }
  return roomStub(env, gameId).fetch(request);
}
