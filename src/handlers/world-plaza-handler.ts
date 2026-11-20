/**
 * @file src/handlers/world-plaza-handler.ts
 * @description Yamato Town の「みんなで（Together）」モードの入口（SQL 58・src/world/plaza-*.ts）
 *
 *   GET  /api/world/plaza/status        → { status }（OK / NOT_AGREED / SCHOOL_ACCOUNT / SUSPENDED / SERVER_ERROR）
 *   POST /api/world/plaza/agree { version } → 決まりへの同意を記録する（学校のアカウント・止められた人は記録しない）
 *   POST /api/world/plaza/join { place }    → 空いている部屋の番号を返す（入れるかどうかも確かめる）
 *   GET  /api/world/plaza/room/<place>/<n>/ws → 部屋への WebSocket（Hono を通さない。本人確認は部屋の中で行う）
 */
import type { Context } from 'hono';
import { getSupabaseAdmin } from '../services/supabase-admin';
import { getAllowedOrigin } from '../services/cors';
import { MAX_ROOMS_PER_PLACE, PLAZA_RULES_VERSION, ROOM_CAPACITY, plazaRoomName, plazaStatus } from '../world/plaza-rules';
import { WORLD_PLACES } from '../world/places';

function roomStub(env: any, name: string) {
  const ns = env.WORLD_PLAZA as DurableObjectNamespace;
  return ns.get(ns.idFromName(name)) as any;
}

export async function handlePlazaStatus(c: Context) {
  const status = await plazaStatus(getSupabaseAdmin(c.env), c.get('userId') as string);
  return c.json({ status, rulesVersion: PLAZA_RULES_VERSION });
}

export async function handlePlazaAgree(c: Context) {
  const userId = c.get('userId') as string;
  const body = (await c.req.json().catch(() => null)) as { version?: unknown } | null;
  if (body?.version !== PLAZA_RULES_VERSION) {
    return c.json({ error: 'OLD_RULES', message: 'The rules have changed. Please reload the page.' }, 409);
  }
  const admin = getSupabaseAdmin(c.env);
  const before = await plazaStatus(admin, userId);
  if (before !== 'NOT_AGREED' && before !== 'OK') return c.json({ status: before });
  const { error } = await admin
    .from('world_plaza_consents')
    .upsert({ user_id: userId, rules_version: PLAZA_RULES_VERSION, agreed_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) {
    console.error('❌ [plaza] consent save failed:', error.message);
    return c.json({ status: 'SERVER_ERROR' }, 500);
  }
  return c.json({ status: 'OK' });
}

export async function handlePlazaJoin(c: Context) {
  const userId = c.get('userId') as string;
  const body = (await c.req.json().catch(() => null)) as { place?: unknown } | null;
  const place = String(body?.place ?? '');
  if (!WORLD_PLACES[place]) return c.json({ error: 'BAD_REQUEST' }, 400);
  const status = await plazaStatus(getSupabaseAdmin(c.env), userId);
  if (status !== 'OK') return c.json({ status }, status === 'SERVER_ERROR' ? 500 : 403);

  for (let n = 1; n <= MAX_ROOMS_PER_PLACE; n++) {
    const name = plazaRoomName(place, n)!;
    try {
      const count = Number(await roomStub(c.env, name).count());
      if (count < ROOM_CAPACITY) return c.json({ status: 'OK', room: n });
    } catch (err: any) {
      console.error('❌ [plaza] room count failed:', err?.message || String(err));
      return c.json({ status: 'SERVER_ERROR' }, 500);
    }
  }
  return c.json({ status: 'FULL' }, 503);
}

/** Hono を通さずに WebSocket を部屋へ渡す */
export function matchPlazaSocket(request: Request): string | null {
  const m = new URL(request.url).pathname.match(/^\/api\/world\/plaza\/room\/([a-z0-9-]{1,40})\/(\d)\/ws$/);
  return m ? plazaRoomName(m[1], Number(m[2])) : null;
}

export async function handlePlazaSocket(request: Request, env: any, roomName: string): Promise<Response> {
  if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
    return new Response('Expected WebSocket', { status: 426 });
  }
  // このサイト以外のページからはつながせない
  if (!getAllowedOrigin(request.headers.get('Origin'))) {
    return new Response('Forbidden', { status: 403 });
  }
  return roomStub(env, roomName).fetch(request);
}
