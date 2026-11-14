/**
 * @file src/live-game/room.ts
 * @description クラスのライブゲームの「部屋」（Cloudflare Durable Object。1 ゲームに 1 つ）
 *
 * 不正を防ぐための決まり：
 * ・問題を作る、正解を判定する、金貨を数える、宝箱の中身を決めるのは、すべてこの部屋（サーバー）。
 * ・生徒の端末から受け取るのは「何番を選んだか」「どの宝箱を開けるか」「名前（自由モードのみ）」だけ。
 * ・正解の番号は、答える前の端末には送らない。
 * ・同じ問題に答えられるのは 1 回だけ。問題を送ってから短すぎる時間で来た答えは受け付けない。
 * ・入れるのは、ログインしていて、そのクラスで先生が承認した生徒（edu_class_members）と、その先生だけ。
 *
 * 端末とは WebSocket でつながる。つないだあと、最初のメッセージで Supabase のアクセストークンを送ってもらい、
 * ここで本人を確かめる（URL にトークンを載せないため）。
 */
import { DurableObject } from 'cloudflare:workers';
import { getSupabaseAdmin } from '../services/supabase-admin';
import unsuitableWordsData from '../data/unsuitable-words.json';
import {
  CORRECT_PER_CHEST,
  loadContent,
  makeQuestion,
  openChest,
  randomInt,
  toPublicQuestion,
  type ContentItem,
  type Question,
  type QuestionSet,
} from './content';

export type RoomConfig = {
  gameId: string;
  classId: string;
  className: string;
  teacherId: string;
  questionSet: QuestionSet;
  durationSec: number;
  nameMode: 'free' | 'preset';
};

type Status = 'lobby' | 'running' | 'ended';

type Player = {
  userId: string;
  /** 画面に出す名前（自由モードで未入力なら null） */
  name: string | null;
  /** 先生にだけ見せる本人の目印（学校メール・招待ラベル） */
  label: string;
  coins: number;
  correct: number;
  answered: number;
  missed: Record<string, number>;
  current: Question | null;
  questionSentAt: number;
  chestPending: boolean;
  recent: string[];
};

type Session = { userId: string | null; role: 'host' | 'student' | null };

/** 問題を送ってから、これより早い答えは受け付けない（自動で連打するプログラム対策） */
const MIN_ANSWER_MS = 400;
/** 開始されないまま放置された部屋を閉じるまでの時間 */
const LOBBY_TTL_MS = 3 * 60 * 60_000;
const AUTH_TIMEOUT_MS = 10_000;
const NAME_MAX = 12;
/** 名前から取り除く、目に見えない文字・制御文字 */
const INVISIBLE_CHARS = new RegExp('[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f]', 'g');
/** 先生の画面に送る順位表の更新間隔 */
const HOST_UPDATE_MS = 400;

/**
 * 自由モードの名前で使えない言葉。ニックネームのチェック（ポータルの app/validations/profile.ts）と同じ一覧。
 * api は Cloudflare のビルドで api のリポジトリだけからデプロイされるので、ポータルの
 * yamato-portal/app/data/unsuitable-words.json のコピーを src/data/ に置いている。
 * 一覧を直すときは、両方のファイルを同じ内容にする。
 */
const UNSUITABLE_WORDS: string[] = Object.values(unsuitableWordsData as Record<string, string[]>)
  .flat()
  .map((w) => w.toLowerCase());

export class LiveGameRoom extends DurableObject {
  private config: RoomConfig | null = null;
  private status: Status = 'lobby';
  private endsAt = 0;
  private players = new Map<string, Player>();
  private kicked = new Set<string>();
  private sessions = new Map<WebSocket, Session>();
  private pool: ContentItem[] = [];
  private presetNames: string[] = [];
  private hostTimer: ReturnType<typeof setTimeout> | null = null;
  private finishing = false;

  constructor(ctx: DurableObjectState, env: any) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.config = (await ctx.storage.get<RoomConfig>('config')) ?? null;
      this.status = (await ctx.storage.get<Status>('status')) ?? 'lobby';
      this.endsAt = (await ctx.storage.get<number>('endsAt')) ?? 0;
    });
  }

  private get admin() {
    return getSupabaseAdmin(this.env);
  }

  // ---------- api から呼ばれる（RPC） ----------

  /** 部屋を作る。問題と名前の一覧もここで読み込む */
  async init(config: RoomConfig): Promise<{ ok: boolean; error?: string }> {
    this.config = config;
    this.status = 'lobby';
    this.endsAt = 0;
    this.players.clear();
    this.kicked.clear();
    await this.ensureContent();
    if (this.pool.length < 4) return { ok: false, error: 'NOT_ENOUGH_CONTENT' };
    await this.ctx.storage.put({ config, status: 'lobby', endsAt: 0 });
    await this.ctx.storage.setAlarm(Date.now() + LOBBY_TTL_MS);
    return { ok: true };
  }

  /** 先生が同じクラスで新しい部屋を作ったとき、古い部屋を閉じる */
  async cancel(): Promise<void> {
    if (this.status === 'ended') return;
    this.status = 'ended';
    await this.ctx.storage.put('status', 'ended');
    await this.ctx.storage.deleteAlarm();
    this.broadcast({ t: 'cancelled' });
    this.closeAll();
  }

  // ---------- WebSocket ----------

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    const session: Session = { userId: null, role: null };
    this.sessions.set(server, session);

    const authTimer = setTimeout(() => {
      if (!session.userId) this.closeSocket(server, 'AUTH_TIMEOUT');
    }, AUTH_TIMEOUT_MS);

    server.addEventListener('message', (event) => {
      this.onMessage(server, session, event.data).catch((err) => {
        console.error('❌ [live-game] message failed:', err?.message || String(err));
        this.send(server, { t: 'error', code: 'SERVER_ERROR' });
      });
    });
    const onClose = () => {
      clearTimeout(authTimer);
      this.sessions.delete(server);
      if (session.role === 'student') this.scheduleHostUpdate();
    };
    server.addEventListener('close', onClose);
    server.addEventListener('error', onClose);

    return new Response(null, { status: 101, webSocket: client });
  }

  private async onMessage(ws: WebSocket, session: Session, raw: unknown) {
    if (typeof raw !== 'string' || raw.length > 4096) return;
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!msg || typeof msg.t !== 'string') return;

    if (!session.userId) {
      if (msg.t === 'auth') await this.authenticate(ws, session, msg.token);
      return;
    }
    if (session.role === 'host') this.onHostMessage(ws, msg);
    else this.onStudentMessage(ws, session.userId, msg);
  }

  private async authenticate(ws: WebSocket, session: Session, token: unknown) {
    const config = this.config;
    if (!config) return this.closeSocket(ws, 'NO_GAME');
    if (typeof token !== 'string' || !token) return this.closeSocket(ws, 'LOGIN_REQUIRED');

    const { data, error } = await this.admin.auth.getUser(token);
    const userId = data?.user?.id;
    if (error || !userId) return this.closeSocket(ws, 'LOGIN_REQUIRED');
    await this.ensureContent();

    if (userId === config.teacherId) {
      session.userId = userId;
      session.role = 'host';
      this.send(ws, this.hostState());
      return;
    }

    if (this.kicked.has(userId)) return this.closeSocket(ws, 'REMOVED');

    // そのクラスで先生に承認された生徒か（毎回データベースで確かめる）
    const { data: member, error: memberError } = await this.admin
      .from('edu_class_members')
      .select('user_id, school_email, invite_label')
      .eq('class_id', config.classId)
      .eq('user_id', userId)
      .eq('role', 'student')
      .maybeSingle();
    if (memberError) {
      console.error('❌ [live-game] member check failed:', memberError.message);
      return this.closeSocket(ws, 'SERVER_ERROR');
    }
    if (!member) return this.closeSocket(ws, 'NOT_IN_CLASS');

    // 同じ生徒が別のタブ・端末でつないだら、古いほうを閉じる
    for (const [other, s] of this.sessions) {
      if (other !== ws && s.userId === userId) this.closeSocket(other, 'OPENED_ELSEWHERE');
    }
    session.userId = userId;
    session.role = 'student';

    let player = this.players.get(userId);
    if (!player) {
      if (this.status === 'ended') return this.closeSocket(ws, 'GAME_OVER');
      player = {
        userId,
        name: null,
        label: (member.invite_label as string) || (member.school_email as string) || 'Student',
        coins: 0,
        correct: 0,
        answered: 0,
        missed: {},
        current: null,
        questionSentAt: 0,
        chestPending: false,
        recent: [],
      };
      if (config.nameMode === 'preset') player.name = await this.assignPresetName();
      this.players.set(userId, player);
    }

    this.send(ws, this.studentState(player));
    if (this.status === 'ended') {
      this.send(ws, this.studentFinal(player));
    } else if (this.status === 'running' && player.name) {
      if (player.current) this.send(ws, { t: 'question', ...toPublicQuestion(player.current) });
      else if (!player.chestPending) this.sendNextQuestion(ws, player);
    }
    this.scheduleHostUpdate();
  }

  // ---------- 生徒 ----------

  private onStudentMessage(ws: WebSocket, userId: string, msg: any) {
    const player = this.players.get(userId);
    if (!player || !this.config) return;

    switch (msg.t) {
      case 'setName': {
        if (this.config.nameMode !== 'free' || this.status === 'ended') return;
        const result = this.validateName(msg.name, userId);
        if (!result.ok) return this.send(ws, { t: 'nameRejected', reason: result.reason });
        const firstTime = !player.name;
        player.name = result.name;
        this.send(ws, this.studentState(player));
        if (firstTime && this.status === 'running') this.sendNextQuestion(ws, player);
        this.scheduleHostUpdate();
        return;
      }
      case 'answer': {
        if (!this.isRunning() || !player.current) return;
        const q = player.current;
        if (msg.qid !== q.qid) return;
        // 速すぎる答えは数えない（端末にはもう一度選び直してもらう）
        if (Date.now() - player.questionSentAt < MIN_ANSWER_MS) return this.send(ws, { t: 'tooFast', qid: q.qid });
        const choice = Number(msg.choice);
        if (!Number.isInteger(choice) || choice < 0 || choice >= q.options.length) return;

        player.current = null; // 同じ問題には 1 回だけ
        player.answered += 1;
        const correct = choice === q.correctIndex;
        if (correct) {
          player.coins += 1;
          player.correct += 1;
          if (player.correct % CORRECT_PER_CHEST === 0) player.chestPending = true;
        } else {
          player.missed[q.itemKey] = (player.missed[q.itemKey] ?? 0) + 1;
        }
        this.send(ws, {
          t: 'result',
          qid: q.qid,
          correct,
          correctIndex: q.correctIndex,
          coins: player.coins,
          chest: player.chestPending,
        });
        this.scheduleHostUpdate();
        return;
      }
      case 'next': {
        if (!this.isRunning() || !player.name || player.current || player.chestPending) return;
        this.sendNextQuestion(ws, player);
        return;
      }
      case 'openChest': {
        if (!this.isRunning() || !player.chestPending) return;
        const box = Number(msg.box);
        if (!Number.isInteger(box) || box < 0 || box > 2) return;
        player.chestPending = false;
        const before = player.coins;
        const { item, coins } = openChest(before);
        player.coins = coins;
        this.send(ws, { t: 'chestResult', box, item, before, coins });
        this.scheduleHostUpdate();
        return;
      }
    }
  }

  private sendNextQuestion(ws: WebSocket, player: Player) {
    if (!this.config) return;
    const q = makeQuestion(this.pool, this.config.questionSet, player.recent);
    if (!q) return this.send(ws, { t: 'error', code: 'NOT_ENOUGH_CONTENT' });
    player.current = q;
    player.questionSentAt = Date.now();
    player.recent = [q.itemKey, ...player.recent].slice(0, Math.min(8, Math.floor(this.pool.length / 2)));
    this.send(ws, { t: 'question', ...toPublicQuestion(q) });
  }

  // ---------- 先生 ----------

  private onHostMessage(ws: WebSocket, msg: any) {
    switch (msg.t) {
      case 'start':
        this.start().catch((err) => console.error('❌ [live-game] start failed:', err?.message || String(err)));
        return;
      case 'end':
        this.finish().catch((err) => console.error('❌ [live-game] finish failed:', err?.message || String(err)));
        return;
      case 'kick': {
        const userId = String(msg.userId ?? '');
        if (!this.players.has(userId)) return;
        this.players.delete(userId);
        this.kicked.add(userId);
        for (const [other, s] of this.sessions) {
          if (s.userId === userId) this.closeSocket(other, 'REMOVED');
        }
        this.scheduleHostUpdate();
        return;
      }
      case 'rename': {
        const player = this.players.get(String(msg.userId ?? ''));
        if (!player) return;
        const result = this.validateName(msg.name, player.userId);
        if (!result.ok) return this.send(ws, { t: 'nameRejected', reason: result.reason });
        const firstTime = !player.name;
        player.name = result.name;
        for (const [other, s] of this.sessions) {
          if (s.userId === player.userId) {
            this.send(other, this.studentState(player));
            if (firstTime && this.status === 'running') this.sendNextQuestion(other, player);
          }
        }
        this.scheduleHostUpdate();
        return;
      }
    }
  }

  private async start() {
    if (!this.config || this.status !== 'lobby') return;
    await this.ensureContent();
    this.status = 'running';
    this.endsAt = Date.now() + this.config.durationSec * 1000;
    await this.ctx.storage.put({ status: 'running', endsAt: this.endsAt });
    await this.ctx.storage.setAlarm(this.endsAt);

    const { error } = await this.admin
      .from('edu_live_games')
      .update({ status: 'running', started_at: new Date().toISOString() })
      .eq('id', this.config.gameId);
    if (error) console.error('❌ [live-game] status update failed:', error.message);

    for (const [ws, s] of this.sessions) {
      if (s.role === 'host') {
        this.send(ws, this.hostState());
      } else if (s.userId) {
        const player = this.players.get(s.userId);
        if (!player) continue;
        this.send(ws, this.studentState(player));
        if (player.name) this.sendNextQuestion(ws, player);
      }
    }
  }

  /** 時間切れ、または先生が終了したとき。結果を保存して全員に発表する */
  private async finish() {
    if (!this.config || this.status !== 'running' || this.finishing) return;
    this.finishing = true;
    this.status = 'ended';
    await this.ctx.storage.put('status', 'ended');
    await this.ctx.storage.deleteAlarm();

    const admin = this.admin;
    const rows = [...this.players.values()].map((p) => ({
      game_id: this.config!.gameId,
      user_id: p.userId,
      display_name: p.name ?? '(no name)',
      coins: p.coins,
      correct_count: p.correct,
      answered_count: p.answered,
      missed: p.missed,
    }));
    if (rows.length) {
      const { error } = await admin.from('edu_live_game_results').upsert(rows, { onConflict: 'game_id,user_id' });
      if (error) console.error('❌ [live-game] results save failed:', error.message);
    }
    const { error } = await admin
      .from('edu_live_games')
      .update({ status: 'ended', ended_at: new Date().toISOString() })
      .eq('id', this.config.gameId);
    if (error) console.error('❌ [live-game] status update failed:', error.message);

    for (const [ws, s] of this.sessions) {
      if (s.role === 'host') this.send(ws, this.hostState());
      else if (s.userId) {
        const player = this.players.get(s.userId);
        if (player) this.send(ws, this.studentFinal(player));
      }
    }
  }

  async alarm() {
    if (this.status === 'running') {
      await this.finish();
    } else if (this.status === 'lobby' && this.config) {
      // 開始されないまま放置された部屋
      await this.admin.from('edu_live_games').update({ status: 'cancelled' }).eq('id', this.config.gameId);
      await this.cancel();
    }
  }

  // ---------- 画面に送る内容 ----------

  private ranking() {
    return [...this.players.values()]
      .filter((p) => p.name)
      .sort((a, b) => b.coins - a.coins || b.correct - a.correct);
  }

  private connectedUserIds() {
    const ids = new Set<string>();
    for (const s of this.sessions.values()) if (s.role === 'student' && s.userId) ids.add(s.userId);
    return ids;
  }

  private hostState() {
    const config = this.config!;
    const online = this.connectedUserIds();
    const ranked = this.ranking();
    const rankOf = new Map(ranked.map((p, i) => [p.userId, i + 1]));
    const players = [...this.players.values()]
      .map((p) => ({
        userId: p.userId,
        name: p.name,
        label: p.label,
        coins: p.coins,
        correct: p.correct,
        answered: p.answered,
        online: online.has(p.userId),
        rank: rankOf.get(p.userId) ?? null,
        missed: this.status === 'ended' ? p.missed : undefined,
      }))
      .sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999) || a.label.localeCompare(b.label));

    // クラス全体で間違いが多かった文字（終了後に先生へ）
    let classMissed: { key: string; count: number }[] | undefined;
    if (this.status === 'ended') {
      const total: Record<string, number> = {};
      for (const p of this.players.values()) {
        for (const [k, n] of Object.entries(p.missed)) total[k] = (total[k] ?? 0) + n;
      }
      classMissed = Object.entries(total)
        .map(([key, count]) => ({ key, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 20);
    }

    return {
      t: 'host',
      status: this.status,
      endsAt: this.endsAt,
      now: Date.now(),
      config: {
        className: config.className,
        questionSet: config.questionSet,
        durationSec: config.durationSec,
        nameMode: config.nameMode,
      },
      players,
      classMissed,
    };
  }

  private studentState(player: Player) {
    const config = this.config!;
    return {
      t: 'student',
      status: this.status,
      endsAt: this.endsAt,
      now: Date.now(),
      className: config.className,
      questionSet: config.questionSet,
      nameMode: config.nameMode,
      name: player.name,
      coins: player.coins,
      chestPending: player.chestPending,
    };
  }

  private studentFinal(player: Player) {
    const ranked = this.ranking();
    const rank = ranked.findIndex((p) => p.userId === player.userId) + 1;
    return {
      t: 'final',
      coins: player.coins,
      correct: player.correct,
      answered: player.answered,
      rank: rank || null,
      total: ranked.length,
      top: ranked.slice(0, 5).map((p) => ({ name: p.name, coins: p.coins })),
    };
  }

  private scheduleHostUpdate() {
    if (this.hostTimer) return;
    this.hostTimer = setTimeout(() => {
      this.hostTimer = null;
      if (!this.config) return;
      const state = this.hostState();
      for (const [ws, s] of this.sessions) if (s.role === 'host') this.send(ws, state);
    }, HOST_UPDATE_MS);
  }

  // ---------- 名前 ----------

  private validateName(raw: unknown, userId: string): { ok: true; name: string } | { ok: false; reason: string } {
    if (typeof raw !== 'string') return { ok: false, reason: 'EMPTY' };
    const name = raw.normalize('NFKC').replace(INVISIBLE_CHARS, '').replace(/\s+/g, ' ').trim();
    if (!name) return { ok: false, reason: 'EMPTY' };
    if ([...name].length > NAME_MAX) return { ok: false, reason: 'TOO_LONG' };
    // そのままの形と、記号・空白を抜いた形（f.u.c.k など）の両方で調べる
    const lower = name.toLowerCase();
    const compact = lower.replace(/[^a-z0-9]/g, '');
    if (UNSUITABLE_WORDS.some((w) => lower.includes(w) || (/^[a-z0-9]+$/.test(w) && compact.includes(w)))) {
      return { ok: false, reason: 'NOT_ALLOWED' };
    }
    for (const p of this.players.values()) {
      if (p.userId !== userId && p.name && p.name.toLowerCase() === name.toLowerCase()) return { ok: false, reason: 'TAKEN' };
    }
    return { ok: true, name };
  }

  private async assignPresetName(): Promise<string> {
    if (!this.presetNames.length) await this.loadPresetNames();
    const taken = new Set([...this.players.values()].map((p) => p.name?.toLowerCase()).filter(Boolean));
    const free = this.presetNames.filter((n) => !taken.has(n.toLowerCase()));
    if (free.length) return free[randomInt(free.length)];
    // 名前が足りないときは番号を付ける
    const base = this.presetNames.length ? this.presetNames[randomInt(this.presetNames.length)] : 'Player';
    for (let i = 2; ; i++) {
      const candidate = `${base} ${i}`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
  }

  private async loadPresetNames() {
    const { data, error } = await this.admin.from('kl_app').select('data').eq('key', 'LIVE_GAME_NAMES').maybeSingle();
    if (error) console.error('❌ [live-game] LIVE_GAME_NAMES load failed:', error.message);
    const names = Array.isArray(data?.data?.names) ? data.data.names : [];
    this.presetNames = names
      .filter((n: unknown): n is string => typeof n === 'string' && n.trim().length > 0)
      .map((n: string) => n.trim().slice(0, NAME_MAX));
  }

  // ---------- そのほか ----------

  private async ensureContent() {
    if (this.pool.length || !this.config) return;
    try {
      this.pool = await loadContent(this.admin, this.config.questionSet);
    } catch (err: any) {
      console.error('❌ [live-game] content load failed:', err?.message || String(err));
    }
  }

  private isRunning() {
    return this.status === 'running' && Date.now() < this.endsAt;
  }

  private send(ws: WebSocket, msg: unknown) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // すでに閉じている
    }
  }

  private closeSocket(ws: WebSocket, code: string) {
    this.send(ws, { t: 'closed', code });
    try {
      ws.close(4000, code);
    } catch {
      // すでに閉じている
    }
    this.sessions.delete(ws);
  }

  private broadcast(msg: unknown) {
    for (const ws of this.sessions.keys()) this.send(ws, msg);
  }

  private closeAll() {
    for (const ws of [...this.sessions.keys()]) {
      try {
        ws.close(4000, 'CLOSED');
      } catch {
        // すでに閉じている
      }
    }
    this.sessions.clear();
  }
}
