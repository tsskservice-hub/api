/**
 * @file src/world/plaza-room.ts
 * @description Yamato Town の「みんなで（Together）」モードの部屋（Cloudflare Durable Object。場所ごと・番号ごとに 1 つ）
 *
 * 部屋がするのは、つながっている人の「位置・アバター・決まった文・スタンプ・AI と話し中か」を配ることだけ。
 * 何も保存しない（報告とブロックだけ、Supabase の表に書く。SQL 58）。
 *
 * 子どもを守る決まり（src/world/plaza-rules.ts）:
 *   ・端末から受け取るのは、位置（数字）と、決まった文・スタンプ・アバターの「番号」だけ。自由な文字は受け取らない
 *   ・名前は、つなぐたびに部屋が作るランダムの町の名前。ほかの人には、その人のアカウント ID を一切送らない
 *     （ほかの人は pid = つなぐたびに変わる番号で表す）
 *   ・入るときに、学校のアカウント・同意・止められていないかを Supabase で確かめる
 *   ・ブロックした／された人どうしは、おたがいに見えない。報告すると、その人はブロックもされる
 *   ・報告が 3 人以上からたまった人は、その場で部屋から出される
 *   ・送りすぎ（文・スタンプは 2.5 秒に 1 回、動きは 1 秒に 15 回まで）は捨てる。15 分何もしない人は切る
 *
 * 端末とは WebSocket でつながる。つないだあと最初のメッセージで Supabase のアクセストークンを送ってもらい、
 * ここで本人を確かめる（URL にトークンを載せないため。ライブゲームの部屋と同じ）。
 */
import { DurableObject } from 'cloudflare:workers';
import { getSupabaseAdmin } from '../services/supabase-admin';
import {
  PLAZA_AVATARS,
  PLAZA_PHRASES,
  PLAZA_STAMPS,
  REPORT_REASONS,
  ROOM_CAPACITY,
  isSuspended,
  makeTownName,
  plazaStatus,
  type ReportReason,
} from './plaza-rules';
import { WORLD_PLACES } from './places';

const AUTH_TIMEOUT_MS = 10_000;
const MOVE_MIN_INTERVAL_MS = 60;
const SAY_MIN_INTERVAL_MS = 2_500;
const FLUSH_MS = 150;
const IDLE_CLOSE_MS = 15 * 60 * 1000;
const MAX_REPORTS_PER_SESSION = 5;
const MAX_BLOCKS_PER_SESSION = 20;

type Session = {
  ws: WebSocket;
  userId: string | null;
  /** ほかの人に見せる番号（つなぐたびに変わる） */
  pid: string;
  name: string;
  avatar: number;
  x: number;
  y: number;
  talking: boolean;
  /** この人から見えない人（ブロックした・された）の userId */
  hidden: Set<string>;
  lastMoveAt: number;
  lastSayAt: number;
  lastActiveAt: number;
  reports: number;
  blocks: number;
  /** 報告のときに残す、最近の発言 */
  recent: { type: 'say' | 'stamp'; text: string; at: string }[];
};

const clamp = (n: unknown, lo: number, hi: number, fallback: number) => {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : fallback;
  return Math.min(hi, Math.max(lo, v));
};
const validIndex = (n: unknown, length: number): number | null =>
  typeof n === 'number' && Number.isInteger(n) && n >= 0 && n < length ? n : null;

export class WorldPlazaRoom extends DurableObject {
  private sessions = new Map<WebSocket, Session>();
  private place = '';
  /** まだ配っていない動き（pid → 位置） */
  private pendingMoves = new Map<string, { x: number; y: number }>();
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private idleTimer: ReturnType<typeof setInterval> | null = null;

  private get admin() {
    return getSupabaseAdmin(this.env as any);
  }

  // ---------- api から呼ばれる（RPC） ----------

  /** 部屋にいる人数（入る部屋を選ぶため） */
  async count(): Promise<number> {
    return this.members().length;
  }

  // ---------- WebSocket ----------

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }
    // /api/world/plaza/room/<place>/<n>/ws
    const m = new URL(request.url).pathname.match(/^\/api\/world\/plaza\/room\/([a-z0-9-]{1,40})\/(\d)\/ws$/);
    if (!m || !WORLD_PLACES[m[1]]) return new Response('Not found', { status: 404 });
    this.place = m[1];

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    // 最初の位置は、入るときに端末が送る（auth の x, y）
    const start = { x: 50, y: 84 };
    const session: Session = {
      ws: server,
      userId: null,
      pid: crypto.randomUUID().replace(/-/g, '').slice(0, 10),
      name: '',
      avatar: 0,
      x: start.x,
      y: start.y,
      talking: false,
      hidden: new Set(),
      lastMoveAt: 0,
      lastSayAt: 0,
      lastActiveAt: Date.now(),
      reports: 0,
      blocks: 0,
      recent: [],
    };
    this.sessions.set(server, session);

    const authTimer = setTimeout(() => {
      if (!session.userId) this.closeSocket(server, 'AUTH_TIMEOUT');
    }, AUTH_TIMEOUT_MS);

    server.addEventListener('message', (event) => {
      this.onMessage(session, event.data).catch((err) => {
        console.error('❌ [plaza] message failed:', err?.message || String(err));
      });
    });
    const onClose = () => {
      clearTimeout(authTimer);
      if (!this.sessions.has(server)) return;
      this.sessions.delete(server);
      if (session.userId) this.broadcastFrom(session, { t: 'leave', pid: session.pid });
      this.pendingMoves.delete(session.pid);
      if (!this.members().length) this.stopTimers();
    };
    server.addEventListener('close', onClose);
    server.addEventListener('error', onClose);

    return new Response(null, { status: 101, webSocket: client });
  }

  private async onMessage(s: Session, raw: unknown) {
    if (typeof raw !== 'string' || raw.length > 512) return;
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!msg || typeof msg.t !== 'string') return;

    if (!s.userId) {
      if (msg.t === 'auth') await this.authenticate(s, msg.token, msg.avatar, msg.x, msg.y);
      return;
    }
    const now = Date.now();
    switch (msg.t) {
      case 'move': {
        if (now - s.lastMoveAt < MOVE_MIN_INTERVAL_MS) return;
        s.lastMoveAt = now;
        s.lastActiveAt = now;
        s.x = clamp(msg.x, 0, 100, s.x);
        s.y = clamp(msg.y, 0, 100, s.y);
        this.pendingMoves.set(s.pid, { x: Math.round(s.x * 10) / 10, y: Math.round(s.y * 10) / 10 });
        return;
      }
      case 'say':
      case 'stamp': {
        const list = msg.t === 'say' ? PLAZA_PHRASES.length : PLAZA_STAMPS.length;
        const i = validIndex(msg.i, list);
        if (i === null || now - s.lastSayAt < SAY_MIN_INTERVAL_MS) return;
        s.lastSayAt = now;
        s.lastActiveAt = now;
        const text = msg.t === 'say' ? PLAZA_PHRASES[i].ja : PLAZA_STAMPS[i];
        s.recent = [...s.recent, { type: msg.t, text, at: new Date(now).toISOString() }].slice(-10);
        this.broadcastFrom(s, { t: msg.t, pid: s.pid, i }, true);
        return;
      }
      case 'avatar': {
        const i = validIndex(msg.i, PLAZA_AVATARS.length);
        if (i === null || now - s.lastSayAt < 1000) return;
        s.lastSayAt = now;
        s.avatar = i;
        this.broadcastFrom(s, { t: 'avatar', pid: s.pid, i }, true);
        return;
      }
      case 'talking': {
        const on = msg.on === true;
        if (on === s.talking) return;
        s.talking = on;
        s.lastActiveAt = now;
        this.broadcastFrom(s, { t: 'talking', pid: s.pid, on }, true);
        return;
      }
      case 'block':
        await this.block(s, msg.pid);
        return;
      case 'report':
        await this.report(s, msg.pid, msg.reason);
        return;
      case 'ping':
        this.send(s.ws, { t: 'pong' });
        return;
    }
  }

  private async authenticate(s: Session, token: unknown, avatar: unknown, x: unknown, y: unknown) {
    if (typeof token !== 'string' || !token) return this.closeSocket(s.ws, 'LOGIN_REQUIRED');
    const { data, error } = await this.admin.auth.getUser(token);
    const userId = data?.user?.id;
    if (error || !userId) return this.closeSocket(s.ws, 'LOGIN_REQUIRED');
    if (!this.sessions.has(s.ws)) return; // 待っている間に閉じた

    const status = await plazaStatus(this.admin, userId);
    if (status !== 'OK') return this.closeSocket(s.ws, status);

    // 同じ人が別のタブ・端末でつないだら、古いほうを閉じる
    for (const other of this.members()) {
      if (other.userId === userId) this.closeSocket(other.ws, 'OPENED_ELSEWHERE');
    }
    if (this.members().length >= ROOM_CAPACITY) return this.closeSocket(s.ws, 'ROOM_FULL');

    // ブロックした・された人
    const { data: blocks, error: blockError } = await this.admin
      .from('world_plaza_blocks')
      .select('blocker_id, blocked_id')
      .or(`blocker_id.eq.${userId},blocked_id.eq.${userId}`)
      .limit(1000);
    if (blockError) {
      console.error('❌ [plaza] block list failed:', blockError.message);
      return this.closeSocket(s.ws, 'SERVER_ERROR');
    }
    for (const b of blocks ?? []) s.hidden.add(b.blocker_id === userId ? String(b.blocked_id) : String(b.blocker_id));
    if (!this.sessions.has(s.ws)) return;

    s.userId = userId;
    s.avatar = validIndex(avatar, PLAZA_AVATARS.length) ?? 0;
    s.x = clamp(x, 0, 100, s.x);
    s.y = clamp(y, 0, 100, s.y);
    s.name = makeTownName(new Set(this.members().map((o) => o.name)));
    s.lastActiveAt = Date.now();

    this.send(s.ws, {
      t: 'welcome',
      you: this.publicOf(s),
      players: this.members()
        .filter((o) => o !== s && this.canSee(s, o))
        .map((o) => this.publicOf(o)),
      phrases: PLAZA_PHRASES,
      stamps: PLAZA_STAMPS,
    });
    this.broadcastFrom(s, { t: 'join', p: this.publicOf(s) });
    this.startTimers();
  }

  /** ブロック（相手が今いなくても、記録はずっと残る） */
  private async block(s: Session, pid: unknown) {
    const target = this.findByPid(pid);
    if (!target || target === s || !target.userId || !s.userId) return;
    if (s.blocks >= MAX_BLOCKS_PER_SESSION) return;
    s.blocks += 1;
    this.hideEachOther(s, target);
    const { error } = await this.admin
      .from('world_plaza_blocks')
      .upsert({ blocker_id: s.userId, blocked_id: target.userId }, { onConflict: 'blocker_id,blocked_id', ignoreDuplicates: true });
    if (error) console.error('❌ [plaza] block save failed:', error.message);
    this.send(s.ws, { t: 'blocked', pid: target.pid });
  }

  /** 報告（その人のブロックもする）。報告がたまった人は、その場で出す */
  private async report(s: Session, pid: unknown, reason: unknown) {
    const target = this.findByPid(pid);
    if (!target || target === s || !target.userId || !s.userId) return;
    if (!REPORT_REASONS.includes(reason as ReportReason)) return;
    if (s.reports >= MAX_REPORTS_PER_SESSION) return;
    s.reports += 1;
    const reportedId = target.userId;
    const recent = target.recent;
    this.hideEachOther(s, target);

    const admin = this.admin;
    const [{ error }] = await Promise.all([
      admin.from('world_plaza_reports').insert({
        reporter_id: s.userId,
        reported_id: reportedId,
        place: this.place,
        reason,
        recent_actions: recent,
      }),
      admin
        .from('world_plaza_blocks')
        .upsert({ blocker_id: s.userId, blocked_id: reportedId }, { onConflict: 'blocker_id,blocked_id', ignoreDuplicates: true }),
    ]);
    if (error) console.error('❌ [plaza] report save failed:', error.message);
    this.send(s.ws, { t: 'reported', pid: target.pid });

    try {
      if (await isSuspended(admin, reportedId)) {
        for (const o of this.members()) if (o.userId === reportedId) this.closeSocket(o.ws, 'SUSPENDED');
      }
    } catch (err: any) {
      console.error('❌ [plaza] suspend check failed:', err?.message || String(err));
    }
  }

  private hideEachOther(a: Session, b: Session) {
    if (!a.userId || !b.userId) return;
    a.hidden.add(b.userId);
    b.hidden.add(a.userId);
    this.send(a.ws, { t: 'leave', pid: b.pid });
    this.send(b.ws, { t: 'leave', pid: a.pid });
  }

  // ---------- 配る ----------

  private members(): Session[] {
    return [...this.sessions.values()].filter((s) => s.userId);
  }

  private canSee(viewer: Session, other: Session) {
    return !(other.userId && viewer.hidden.has(other.userId)) && !(viewer.userId && other.hidden.has(viewer.userId));
  }

  private publicOf(s: Session) {
    return { pid: s.pid, name: s.name, avatar: s.avatar, x: s.x, y: s.y, talking: s.talking };
  }

  private findByPid(pid: unknown): Session | null {
    if (typeof pid !== 'string') return null;
    return this.members().find((s) => s.pid === pid) ?? null;
  }

  /** from の動きを、from が見える人に配る（includeSelf なら本人にも） */
  private broadcastFrom(from: Session, msg: unknown, includeSelf = false) {
    const text = JSON.stringify(msg);
    for (const s of this.members()) {
      if (s === from ? !includeSelf : !this.canSee(s, from)) continue;
      try {
        s.ws.send(text);
      } catch {
        /* 閉じかけ */
      }
    }
  }

  /** 動きは 150 ミリ秒ごとにまとめて配る */
  private flushMoves() {
    if (!this.pendingMoves.size) return;
    const moves = [...this.pendingMoves.entries()];
    this.pendingMoves.clear();
    const byPid = new Map(this.members().map((s) => [s.pid, s]));
    for (const viewer of this.members()) {
      const list = moves
        .filter(([pid]) => pid !== viewer.pid)
        .filter(([pid]) => {
          const from = byPid.get(pid);
          return from && this.canSee(viewer, from);
        })
        .map(([pid, p]) => [pid, p.x, p.y]);
      if (list.length) this.send(viewer.ws, { t: 'moves', m: list });
    }
  }

  private startTimers() {
    if (!this.flushTimer) this.flushTimer = setInterval(() => this.flushMoves(), FLUSH_MS);
    if (!this.idleTimer) {
      this.idleTimer = setInterval(() => {
        const now = Date.now();
        for (const s of this.members()) if (now - s.lastActiveAt > IDLE_CLOSE_MS) this.closeSocket(s.ws, 'IDLE');
      }, 30_000);
    }
  }

  private stopTimers() {
    if (this.flushTimer) clearInterval(this.flushTimer);
    if (this.idleTimer) clearInterval(this.idleTimer);
    this.flushTimer = null;
    this.idleTimer = null;
    this.pendingMoves.clear();
  }

  private send(ws: WebSocket, msg: unknown) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* 閉じかけ */
    }
  }

  private closeSocket(ws: WebSocket, code: string) {
    this.send(ws, { t: 'closed', code });
    const s = this.sessions.get(ws);
    this.sessions.delete(ws);
    if (s?.userId) this.broadcastFrom(s, { t: 'leave', pid: s.pid });
    try {
      ws.close(4000, code);
    } catch {
      /* もう閉じている */
    }
    if (!this.members().length) this.stopTimers();
  }
}
