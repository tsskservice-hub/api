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
 * じゃんけん勝負（宝箱のカード）：
 * ・2 人の手がそろうまで、サーバーはどちらにも相手の手を教えない。判定と金貨の移動もサーバー。
 * ・そろったら「この時刻に見せて」（revealAt）を 2 人に送り、端末は同じ時刻に「じゃんけんぽん！」と両方の手を出す。
 * ・負けた人の金貨の半分が勝った人へ。あいこは何も起きない。5 秒で手を選ばなければランダム。
 * ・同じ相手に続けて挑めない。挑まれた人はしばらく挑まれない。先生は部屋を作るときに「じゃんけんなし」を選べる。
 *
 * 早押しタイム（ペアの対決）：
 * ・ゲーム開始 1 分 30 秒後から 3 分ごとに、つながっている生徒を全員いっせいに 2 人ずつ組ませる（同じ相手はなるべく避ける）。
 * ・ペアに同じ問題を同時に出し、サーバーに正解が先に届いたほうの勝ち。間違えたらその問題は終わり。
 *   2 人とも間違えた、または 10 秒以内に誰も正解しなかったらあいこ（何も起きない）。
 * ・負けた人の金貨の 4 分の 1 が勝った人へ。人数が奇数のときは 1 人お休みで +3 枚（毎回なるべく別の人）。
 * ・じゃんけんの最中・宝箱を開ける途中・じゃんけんのカードで相手を選んでいる人は、その回はお休み。
 *
 * ヤマトの問題（クラス全員）：
 * ・開始 3 分後から 3 分ごと（早押しタイムと交互）。画面が暗くなり、ヤマトのマークだけが現れるのが合図。
 * ・全員に同じ問題。1 人 1 回。サーバーに正解が届いた順に、1 位 10 枚 … 10 位 1 枚。
 * ・正解の番号は、締め切りまでだれにも送らない（先に答えた人が周りに教えられないように）。
 * ・言葉の問題と文化クイズ（毎日クイズ DAILY_QUIZZES のうち topic が文化のもの）を交互に出す。
 * ・出ている間は、新しいじゃんけんは始まらない。
 *
 * みんなでジグソー（mode = 'jigsaw'。協力型）：
 * ・正解すると、袋からピースが 1 つ届く。生徒は空いているマスをタップして置くか、パスする。
 * ・どのピースがどのマスに入るかは、この部屋だけが知っている（端末にはピースの絵だけを送る）。
 * ・正しいマスなら貢献度 +1 で、全員の盤面に反映。間違い・パス・90 秒置かなかったときは、ピースが袋に戻る。
 * ・全部そろったら、その時点でゲーム終了。時間切れなら、何 % できたかを出す。
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
  makeCultureQuestion,
  loadCultureQuiz,
  openChest,
  judgeJanken,
  randomInt,
  HANDS,
  type Hand,
  toPublicQuestion,
  type ContentItem,
  type CultureQuizItem,
  type Question,
  type QuestionSet,
} from './content';

/** 先生のブラウザが切り分けたピース（slot = 左上から右へ数えたマスの番号） */
export type JigsawPieceInput = { slot: number; data: string };

export type RoomConfig = {
  gameId: string;
  classId: string;
  className: string;
  teacherId: string;
  questionSet: QuestionSet;
  durationSec: number;
  nameMode: 'free' | 'preset';
  /** じゃんけん勝負のカードを宝箱に入れるか */
  janken: boolean;
  /** 早押しタイム（ペアの対決）をするか */
  speed: boolean;
  /** ヤマトの問題（クラス全員）を出すか */
  yamato: boolean;
  /** 遊び方：金貨バトル（coins）／みんなでジグソー（jigsaw）。古い部屋には無いので coins とみなす */
  mode?: 'coins' | 'jigsaw';
  jigsaw?: {
    imageUrl: string;
    width: number;
    height: number;
    cols: number;
    rows: number;
    title: string;
    credit: string | null;
  } | null;
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
  /** ほかの生徒に見せる番号（userId は他の生徒に送らない） */
  pid: string;
  /** じゃんけん勝負のカードを持っていて、相手を選んでいるところ */
  jankenCard: boolean;
  /** じゃんけんの最中なら、その勝負の ID */
  duelId: string | null;
  /** 最後に挑んだ相手（続けて同じ人に挑めない） */
  lastTarget: string | null;
  /** この時刻までは挑まれない */
  protectedUntil: number;
  /** 早押しタイムの対決中なら、その ID */
  speedId: string | null;
  /** 早押しタイムでお休みになった回数（なるべく別の人をお休みにするため） */
  speedByes: number;
  /** ジグソー：いま持っているピース（pid）と、受け取った時刻 */
  piece: string | null;
  pieceSince: number;
  /** ジグソー：正しく置けたピースの数（貢献度） */
  contributions: number;
};

type YamatoRound = {
  id: string;
  question: Question;
  /** この時刻から答えられる（それまでは、マークが現れる演出） */
  opensAt: number;
  deadline: number;
  answered: Set<string>;
  /** 正解した順の userId */
  ranking: string[];
  timer: ReturnType<typeof setTimeout>;
  ended: boolean;
};

type SpeedMatch = {
  id: string;
  a: string;
  b: string;
  question: Question;
  startedAt: number;
  deadline: number;
  wrong: Set<string>;
  timer: ReturnType<typeof setTimeout>;
};

type Duel = {
  id: string;
  /** 挑んだ人の userId */
  a: string;
  /** 挑まれた人の userId */
  b: string;
  hands: Record<string, Hand>;
  deadline: number;
  timer: ReturnType<typeof setTimeout>;
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
/** じゃんけんで手を選べる時間 */
const JANKEN_CHOOSE_MS = 5000;
/** 判定してから、端末が「じゃんけんぽん！」と手を見せるまでの時間（音声の長さぶん） */
const JANKEN_REVEAL_DELAY_MS = 1800;
/** 挑まれた人が、次に挑まれるまでの時間 */
const JANKEN_PROTECT_MS = 30_000;
/** 先生の画面の実況に残す件数 */
const FEED_MAX = 15;
/** 早押しタイム：最初の回（開始からの時間）と、その後の間隔 */
const SPEED_FIRST_MS = 90_000;
const SPEED_INTERVAL_MS = 180_000;
/** 早押しタイムの制限時間 */
const SPEED_ANSWER_MS = 10_000;
/** 早押しタイムで、問題を送ってからこれより早い答えは受け付けない */
const SPEED_MIN_ANSWER_MS = 300;
/** 早押しタイムで、負けた人が渡す金貨の割合（4 分の 1） */
const SPEED_STAKE_DIVISOR = 4;
/** 早押しタイムでお休みになった人に渡す金貨 */
const SPEED_BYE_COINS = 3;
/** ヤマトの問題：最初の回と、その後の間隔（早押しタイムと交互になる） */
const YAMATO_FIRST_MS = 180_000;
const YAMATO_INTERVAL_MS = 180_000;
/** マークが現れてから問題が開くまで */
const YAMATO_INTRO_MS = 2000;
/** 答える時間 */
const YAMATO_ANSWER_MS = 15_000;
/** 終わったあと、正解と上位を見せておく時間 */
const YAMATO_SHOW_RESULT_MS = 8000;
/** 上位何人に金貨を配るか（1 位がこの枚数、1 つ下がるごとに 1 枚減る） */
const YAMATO_TOP = 10;
/** ジグソー：ピースを持っていられる時間（過ぎたら袋に戻す） */
const PIECE_HOLD_MS = 90_000;

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
  private duels = new Map<string, Duel>();
  private speedMatches = new Map<string, SpeedMatch>();
  private speedTimer: ReturnType<typeof setTimeout> | null = null;
  /** これまでの早押しタイムで組んだペア（同じ相手をなるべく避ける） */
  private speedPairs = new Set<string>();
  private yamatoRound: YamatoRound | null = null;
  private yamatoTimer: ReturnType<typeof setTimeout> | null = null;
  private yamatoCount = 0;
  private culture: CultureQuizItem[] | null = null;
  /** ジグソー：pid → 正しいマス（端末には送らない） */
  private pieceSlot = new Map<string, number>();
  /** ジグソー：pid → ピースの絵（data URL） */
  private pieceData = new Map<string, string>();
  /** ジグソー：置き終わったマス */
  private placed = new Set<number>();
  /** ジグソー：まだ誰も持っていない、置かれていないピース */
  private bag: string[] = [];
  private jigsawLoaded = false;
  private pieceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private feed: { at: number; text: string }[] = [];

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
  async init(config: RoomConfig, pieces: JigsawPieceInput[] = []): Promise<{ ok: boolean; error?: string }> {
    this.config = config;
    this.status = 'lobby';
    this.endsAt = 0;
    this.players.clear();
    this.kicked.clear();
    this.feed = [];
    await this.ensureContent();
    if (this.pool.length < 4) return { ok: false, error: 'NOT_ENOUGH_CONTENT' };

    if (config.mode === 'jigsaw') {
      // ピースに、場所の分からない番号（pid）を付けて、部屋の保存領域にも置く（部屋が入れ替わっても続けられるように）
      this.pieceSlot.clear();
      this.pieceData.clear();
      this.placed.clear();
      const entries: Record<string, unknown> = {};
      for (const p of pieces) {
        const pid = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
        this.pieceSlot.set(pid, p.slot);
        this.pieceData.set(pid, p.data);
        entries[`piece:${pid}`] = { slot: p.slot, data: p.data };
      }
      const keys = Object.keys(entries);
      for (let i = 0; i < keys.length; i += 100) {
        const chunk: Record<string, unknown> = {};
        for (const k of keys.slice(i, i + 100)) chunk[k] = entries[k];
        await this.ctx.storage.put(chunk);
      }
      await this.ctx.storage.put('placed', []);
      this.bag = [...this.pieceSlot.keys()];
      this.jigsawLoaded = true;
    }
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
    await this.ensureJigsaw();

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
        pid: crypto.randomUUID().slice(0, 8),
        jankenCard: false,
        duelId: null,
        lastTarget: null,
        protectedUntil: 0,
        speedId: null,
        speedByes: 0,
        piece: null,
        pieceSince: 0,
        contributions: 0,
      };
      if (config.nameMode === 'preset') player.name = await this.assignPresetName();
      this.players.set(userId, player);
    }

    this.send(ws, this.studentState(player));
    if (this.status === 'ended') {
      this.send(ws, this.studentFinal(player));
    } else if (this.status === 'running' && player.name) {
      if (player.current) this.send(ws, { t: 'question', ...toPublicQuestion(player.current) });
      if (player.jankenCard) this.send(ws, { t: 'jankenTargets', targets: this.jankenTargets(player) });
      const duel = player.duelId ? this.duels.get(player.duelId) : null;
      if (duel) this.sendDuelStart(duel, player.userId);
      const match = player.speedId ? this.speedMatches.get(player.speedId) : null;
      if (match) this.sendSpeedStart(match, player.userId);
      if (this.yamatoRound && !this.yamatoRound.ended) this.sendYamatoStart(this.yamatoRound, player.userId);
      if (player.piece) this.sendPiece(player);
      if (!player.current && !player.chestPending && !player.jankenCard && !player.duelId && !player.speedId && !player.piece) {
        this.sendNextQuestion(ws, player);
      }
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
        if (!this.isRunning() || !player.current || player.duelId || player.jankenCard || player.speedId) return;
        const q = player.current;
        if (msg.qid !== q.qid) return;
        // 速すぎる答えは数えない（端末にはもう一度選び直してもらう）
        if (Date.now() - player.questionSentAt < MIN_ANSWER_MS) return this.send(ws, { t: 'tooFast', qid: q.qid });
        const choice = Number(msg.choice);
        if (!Number.isInteger(choice) || choice < 0 || choice >= q.options.length) return;

        player.current = null; // 同じ問題には 1 回だけ
        player.answered += 1;
        const correct = choice === q.correctIndex;
        if (this.isJigsaw()) {
          if (correct) player.correct += 1;
          else player.missed[q.itemKey] = (player.missed[q.itemKey] ?? 0) + 1;
          // 正解したら、袋からピースを 1 つ渡す（袋が空なら、また後で）
          const gotPiece = correct && this.handOutPiece(player);
          this.send(ws, { t: 'result', qid: q.qid, correct, correctIndex: q.correctIndex, coins: 0, chest: false, piece: gotPiece, bagEmpty: correct && !gotPiece });
          if (gotPiece) this.sendPiece(player);
          this.scheduleHostUpdate();
          return;
        }
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
        if (!this.isRunning() || !player.name || player.current || player.chestPending || player.jankenCard || player.duelId || player.speedId || player.piece) {
          return;
        }
        this.sendNextQuestion(ws, player);
        return;
      }
      case 'openChest': {
        if (!this.isRunning() || !player.chestPending || player.speedId) return;
        const box = Number(msg.box);
        if (!Number.isInteger(box) || box < 0 || box > 2) return;
        player.chestPending = false;
        const before = player.coins;
        const { item, coins } = openChest(before, { janken: this.config.janken });
        player.coins = coins;
        if (item.id === 'janken') {
          const targets = this.jankenTargets(player);
          if (targets.length) {
            player.jankenCard = true;
            this.send(ws, { t: 'chestResult', box, item, before, coins, targets });
          } else {
            // 挑める人がいないときは、かわりに金貨 +3
            player.coins += 3;
            this.send(ws, { t: 'chestResult', box, item, before, coins: player.coins, noTargets: true });
          }
        } else {
          this.send(ws, { t: 'chestResult', box, item, before, coins });
          if (item.id === 'kozuchi' && player.name) {
            this.addFeed(`🔨 ${player.name} found the Uchide no Kozuchi — coins doubled! (${before} → ${coins})`);
          }
        }
        this.scheduleHostUpdate();
        return;
      }
      case 'refreshTargets': {
        if (player.jankenCard) this.send(ws, { t: 'jankenTargets', targets: this.jankenTargets(player) });
        return;
      }
      case 'skipChallenge': {
        player.jankenCard = false;
        return;
      }
      case 'challenge': {
        if (!this.isRunning() || !player.jankenCard || player.speedId) return;
        if (this.yamatoRound && !this.yamatoRound.ended) {
          return this.send(ws, { t: 'jankenTargets', targets: this.jankenTargets(player), failed: true, reason: 'YAMATO' });
        }
        const target = [...this.players.values()].find((p) => p.pid === String(msg.pid ?? ''));
        if (!target || !this.canBeChallenged(player, target)) {
          return this.send(ws, { t: 'jankenTargets', targets: this.jankenTargets(player), failed: true });
        }
        this.startDuel(player, target);
        return;
      }
      case 'place': {
        this.onPlace(player, msg);
        return;
      }
      case 'passPiece': {
        if (player.piece && msg.pid === player.piece) {
          this.returnPiece(player);
          this.send(ws, { t: 'pieceGone', reason: 'PASSED' });
        }
        return;
      }
      case 'yamatoAnswer': {
        this.onYamatoAnswer(player, msg);
        return;
      }
      case 'speedAnswer': {
        this.onSpeedAnswer(player, msg);
        return;
      }
      case 'hand': {
        const duel = player.duelId ? this.duels.get(player.duelId) : null;
        const hand = String(msg.hand ?? '') as Hand;
        if (!duel || duel.id !== msg.duelId || !HANDS.includes(hand) || duel.hands[userId]) return;
        duel.hands[userId] = hand;
        if (duel.hands[duel.a] && duel.hands[duel.b]) this.resolveDuel(duel.id);
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

  // ---------- じゃんけん ----------

  private canBeChallenged(challenger: Player, target: Player) {
    if (target.userId === challenger.userId || !target.name) return false;
    if (target.userId === challenger.lastTarget) return false;
    if (target.duelId || target.jankenCard || target.chestPending || target.speedId) return false;
    if (target.protectedUntil > Date.now()) return false;
    return this.connectedUserIds().has(target.userId);
  }

  /** 挑める相手の一覧（他の生徒には userId ではなく pid を送る） */
  private jankenTargets(player: Player) {
    return [...this.players.values()]
      .filter((p) => this.canBeChallenged(player, p))
      .sort((a, b) => b.coins - a.coins)
      .map((p) => ({ pid: p.pid, name: p.name, coins: p.coins }));
  }

  private startDuel(a: Player, b: Player) {
    const now = Date.now();
    const id = crypto.randomUUID();
    a.jankenCard = false;
    a.lastTarget = b.userId;
    b.protectedUntil = now + JANKEN_PROTECT_MS;
    a.duelId = id;
    b.duelId = id;
    const duel: Duel = {
      id,
      a: a.userId,
      b: b.userId,
      hands: {},
      deadline: now + JANKEN_CHOOSE_MS,
      // 時間内に選ばなかった人の手は、サーバーがランダムに決める
      timer: setTimeout(() => this.resolveDuel(id), JANKEN_CHOOSE_MS + 300),
    };
    this.duels.set(id, duel);
    this.sendDuelStart(duel, a.userId);
    this.sendDuelStart(duel, b.userId);
    this.addFeed(`✊ ${a.name} challenged ${b.name} to janken!`);
  }

  private sendDuelStart(duel: Duel, userId: string) {
    const meIsA = duel.a === userId;
    const opponent = this.players.get(meIsA ? duel.b : duel.a);
    this.sendToUser(userId, {
      t: 'duelStart',
      duelId: duel.id,
      role: meIsA ? 'challenger' : 'challenged',
      opponentName: opponent?.name ?? '?',
      deadline: duel.deadline,
      now: Date.now(),
      chosen: Boolean(duel.hands[userId]),
    });
  }

  private resolveDuel(duelId: string) {
    const duel = this.duels.get(duelId);
    if (!duel) return;
    this.duels.delete(duelId);
    clearTimeout(duel.timer);
    const a = this.players.get(duel.a);
    const b = this.players.get(duel.b);
    if (a) a.duelId = null;
    if (b) b.duelId = null;
    if (!a || !b || this.status !== 'running') {
      // 先生が外した・ゲームが終わった
      if (a) this.sendToUser(a.userId, { t: 'duelCancelled', duelId });
      if (b) this.sendToUser(b.userId, { t: 'duelCancelled', duelId });
      return;
    }

    const handA = duel.hands[a.userId] ?? HANDS[randomInt(3)];
    const handB = duel.hands[b.userId] ?? HANDS[randomInt(3)];
    const outcomeA = judgeJanken(handA, handB);
    let transfer = 0;
    if (outcomeA === 'win') {
      transfer = Math.floor(b.coins / 2);
      b.coins -= transfer;
      a.coins += transfer;
    } else if (outcomeA === 'lose') {
      transfer = Math.floor(a.coins / 2);
      a.coins -= transfer;
      b.coins += transfer;
    }

    const now = Date.now();
    const revealAt = now + JANKEN_REVEAL_DELAY_MS;
    const outcomeB = outcomeA === 'win' ? 'lose' : outcomeA === 'lose' ? 'win' : 'draw';
    const deltaFor = (o: string) => (o === 'win' ? transfer : o === 'lose' ? -transfer : 0);
    this.sendToUser(a.userId, {
      t: 'duelResult',
      duelId,
      yourHand: handA,
      opponentHand: handB,
      opponentName: b.name,
      outcome: outcomeA,
      delta: deltaFor(outcomeA),
      coins: a.coins,
      revealAt,
      now,
    });
    this.sendToUser(b.userId, {
      t: 'duelResult',
      duelId,
      yourHand: handB,
      opponentHand: handA,
      opponentName: a.name,
      outcome: outcomeB,
      delta: deltaFor(outcomeB),
      coins: b.coins,
      revealAt,
      now,
    });

    // 実況は、生徒の画面で手が開くのと同じころに出す
    const emoji: Record<Hand, string> = { rock: '✊', scissors: '✌️', paper: '✋' };
    setTimeout(() => {
      const text =
        outcomeA === 'draw'
          ? `${emoji[handA]} ${a.name} vs ${b.name} ${emoji[handB]} — a draw!`
          : `${emoji[handA]} ${a.name} vs ${b.name} ${emoji[handB]} — ${outcomeA === 'win' ? a.name : b.name} wins ${transfer} coins!`;
      this.addFeed(text);
    }, JANKEN_REVEAL_DELAY_MS);
  }

  // ---------- 早押しタイム ----------

  private scheduleSpeedRound(at: number) {
    if (this.speedTimer) clearTimeout(this.speedTimer);
    this.speedTimer = null;
    if (this.yamatoTimer) clearTimeout(this.yamatoTimer);
    this.yamatoTimer = null;
    if (this.yamatoRound) clearTimeout(this.yamatoRound.timer);
    this.yamatoRound = null;
    for (const t of this.pieceTimers.values()) clearTimeout(t);
    this.pieceTimers.clear();
    if (!this.config?.speed || this.status !== 'running') return;
    // 終わる直前には始めない
    if (at + SPEED_ANSWER_MS + 5000 > this.endsAt) return;
    this.speedTimer = setTimeout(() => {
      this.speedTimer = null;
      this.startSpeedRound();
      this.scheduleSpeedRound(at + SPEED_INTERVAL_MS);
    }, Math.max(0, at - Date.now()));
  }

  private startSpeedRound() {
    if (!this.isRunning() || !this.config) return;
    const online = this.connectedUserIds();
    const eligible = [...this.players.values()].filter(
      (p) => p.name && online.has(p.userId) && !p.duelId && !p.jankenCard && !p.chestPending && !p.speedId
    );
    if (eligible.length < 2) return;

    // 奇数なら、お休みの回数がいちばん少ない人を 1 人お休みにする
    let bye: Player | null = null;
    if (eligible.length % 2 === 1) {
      const fewest = Math.min(...eligible.map((p) => p.speedByes));
      const candidates = eligible.filter((p) => p.speedByes === fewest);
      bye = candidates[randomInt(candidates.length)];
      eligible.splice(eligible.indexOf(bye), 1);
    }

    // 同じ相手がなるべく出ないように、何通りか試していちばん重なりが少ない組み方にする
    const key = (x: Player, y: Player) => [x.userId, y.userId].sort().join('|');
    let best: [Player, Player][] = [];
    let bestRepeats = Infinity;
    for (let attempt = 0; attempt < 20 && bestRepeats > 0; attempt++) {
      const order = [...eligible];
      for (let i = order.length - 1; i > 0; i--) {
        const j = randomInt(i + 1);
        [order[i], order[j]] = [order[j], order[i]];
      }
      const pairs: [Player, Player][] = [];
      for (let i = 0; i + 1 < order.length; i += 2) pairs.push([order[i], order[i + 1]]);
      const repeats = pairs.filter(([x, y]) => this.speedPairs.has(key(x, y))).length;
      if (repeats < bestRepeats) {
        best = pairs;
        bestRepeats = repeats;
      }
    }

    const now = Date.now();
    for (const [a, b] of best) {
      const question = makeQuestion(this.pool, this.config.questionSet, []);
      if (!question) continue;
      this.speedPairs.add(key(a, b));
      const id = crypto.randomUUID();
      const match: SpeedMatch = {
        id,
        a: a.userId,
        b: b.userId,
        question,
        startedAt: now,
        deadline: now + SPEED_ANSWER_MS,
        wrong: new Set(),
        timer: setTimeout(() => this.resolveSpeed(id, null), SPEED_ANSWER_MS + 300),
      };
      a.speedId = id;
      b.speedId = id;
      this.speedMatches.set(id, match);
      this.sendSpeedStart(match, a.userId);
      this.sendSpeedStart(match, b.userId);
    }
    if (bye) {
      bye.speedByes += 1;
      bye.coins += SPEED_BYE_COINS;
      this.sendToUser(bye.userId, { t: 'speedBye', coins: bye.coins, bonus: SPEED_BYE_COINS });
    }
    this.addFeed(`⚡ Speed round! ${best.length} pair${best.length === 1 ? '' : 's'} are racing.`);
  }

  private sendSpeedStart(match: SpeedMatch, userId: string) {
    const opponent = this.players.get(match.a === userId ? match.b : match.a);
    this.sendToUser(userId, {
      t: 'speedStart',
      matchId: match.id,
      opponentName: opponent?.name ?? '?',
      question: toPublicQuestion(match.question),
      deadline: match.deadline,
      now: Date.now(),
      wrong: match.wrong.has(userId),
    });
  }

  private onSpeedAnswer(player: Player, msg: any) {
    const match = player.speedId ? this.speedMatches.get(player.speedId) : null;
    if (!match || msg.matchId !== match.id || match.wrong.has(player.userId)) return;
    if (Date.now() - match.startedAt < SPEED_MIN_ANSWER_MS) return this.sendToUser(player.userId, { t: 'speedTooFast' });
    const choice = Number(msg.choice);
    if (!Number.isInteger(choice) || choice < 0 || choice >= match.question.options.length) return;

    if (choice === match.question.correctIndex) {
      this.resolveSpeed(match.id, player.userId);
      return;
    }
    match.wrong.add(player.userId);
    player.missed[match.question.itemKey] = (player.missed[match.question.itemKey] ?? 0) + 1;
    this.sendToUser(player.userId, { t: 'speedWrong', matchId: match.id });
    if (match.wrong.has(match.a) && match.wrong.has(match.b)) this.resolveSpeed(match.id, null);
  }

  /** winnerId: 先に正解した人。null ならあいこ（2 人とも間違い・時間切れ） */
  private resolveSpeed(matchId: string, winnerId: string | null) {
    const match = this.speedMatches.get(matchId);
    if (!match) return;
    this.speedMatches.delete(matchId);
    clearTimeout(match.timer);
    const a = this.players.get(match.a);
    const b = this.players.get(match.b);
    if (a) a.speedId = null;
    if (b) b.speedId = null;
    if (!a || !b || this.status !== 'running') {
      if (a) this.sendToUser(a.userId, { t: 'speedCancelled', matchId });
      if (b) this.sendToUser(b.userId, { t: 'speedCancelled', matchId });
      return;
    }

    let transfer = 0;
    if (winnerId) {
      const winner = winnerId === a.userId ? a : b;
      const loser = winner === a ? b : a;
      transfer = Math.floor(loser.coins / SPEED_STAKE_DIVISOR);
      loser.coins -= transfer;
      winner.coins += transfer;
      this.addFeed(`⚡ ${winner.name} beat ${loser.name} to the answer${transfer ? ` (+${transfer} coins)` : ''}!`);
    }
    for (const [me, other] of [
      [a, b],
      [b, a],
    ] as const) {
      const outcome = !winnerId ? 'draw' : winnerId === me.userId ? 'win' : 'lose';
      this.sendToUser(me.userId, {
        t: 'speedResult',
        matchId,
        outcome,
        delta: outcome === 'win' ? transfer : outcome === 'lose' ? -transfer : 0,
        coins: me.coins,
        correctIndex: match.question.correctIndex,
        opponentName: other.name,
      });
    }
    this.scheduleHostUpdate();
  }

  // ---------- みんなでジグソー ----------

  private isJigsaw() {
    return this.config?.mode === 'jigsaw';
  }

  /** 部屋が入れ替わったときに、保存領域からピースと盤面を読み戻す */
  private async ensureJigsaw() {
    if (!this.isJigsaw() || this.jigsawLoaded) return;
    const stored = await this.ctx.storage.list<{ slot: number; data: string }>({ prefix: 'piece:' });
    for (const [key, value] of stored) {
      const pid = key.slice('piece:'.length);
      this.pieceSlot.set(pid, value.slot);
      this.pieceData.set(pid, value.data);
    }
    this.placed = new Set((await this.ctx.storage.get<number[]>('placed')) ?? []);
    this.bag = [...this.pieceSlot.entries()].filter(([, slot]) => !this.placed.has(slot)).map(([pid]) => pid);
    this.jigsawLoaded = true;
  }

  private handOutPiece(player: Player) {
    if (player.piece || !this.bag.length) return false;
    const pid = this.bag.splice(randomInt(this.bag.length), 1)[0];
    player.piece = pid;
    player.pieceSince = Date.now();
    // 置かずに持ち続けないよう、時間が来たら袋に戻す
    this.pieceTimers.set(
      player.userId,
      setTimeout(() => {
        if (player.piece === pid) {
          this.returnPiece(player);
          this.sendToUser(player.userId, { t: 'pieceGone', reason: 'TIMEOUT' });
        }
      }, PIECE_HOLD_MS)
    );
    return true;
  }

  private returnPiece(player: Player) {
    const timer = this.pieceTimers.get(player.userId);
    if (timer) clearTimeout(timer);
    this.pieceTimers.delete(player.userId);
    if (player.piece) {
      const slot = this.pieceSlot.get(player.piece);
      if (slot !== undefined && !this.placed.has(slot)) this.bag.push(player.piece);
    }
    player.piece = null;
  }

  private sendPiece(player: Player) {
    if (!player.piece) return;
    this.sendToUser(player.userId, {
      t: 'piece',
      pid: player.piece,
      data: this.pieceData.get(player.piece),
      expiresAt: player.pieceSince + PIECE_HOLD_MS,
      now: Date.now(),
    });
  }

  private onPlace(player: Player, msg: any) {
    if (!this.isRunning() || !this.config?.jigsaw || !player.piece || msg.pid !== player.piece) return;
    const { cols, rows } = this.config.jigsaw;
    const slot = Number(msg.slot);
    if (!Number.isInteger(slot) || slot < 0 || slot >= cols * rows) return;
    const pid = player.piece;
    const correct = this.pieceSlot.get(pid) === slot && !this.placed.has(slot);
    if (!correct) {
      // 間違い：ピースは袋に戻り、また誰かに配られる。貢献度は減らない
      this.returnPiece(player);
      this.sendToUser(player.userId, { t: 'placeResult', correct: false });
      return;
    }
    const timer = this.pieceTimers.get(player.userId);
    if (timer) clearTimeout(timer);
    this.pieceTimers.delete(player.userId);
    player.piece = null;
    player.contributions += 1;
    this.placed.add(slot);
    this.ctx.storage.put('placed', [...this.placed]).catch(() => {});
    this.sendToUser(player.userId, { t: 'placeResult', correct: true, contributions: player.contributions });
    // 全員の盤面に反映
    for (const [ws, s] of this.sessions) if (s.role === 'student') this.send(ws, { t: 'placed', slot });
    if (player.name && player.contributions % 5 === 0) this.addFeed(`🧩 ${player.name} has placed ${player.contributions} pieces!`);
    this.scheduleHostUpdate();
    if (this.placed.size === cols * rows) {
      this.addFeed('🎉 The puzzle is complete!');
      this.finish().catch((err) => console.error('❌ [live-game] finish failed:', err?.message || String(err)));
    }
  }

  private jigsawBoard() {
    const j = this.config?.jigsaw;
    if (!this.isJigsaw() || !j) return null;
    return {
      imageUrl: j.imageUrl,
      width: j.width,
      height: j.height,
      cols: j.cols,
      rows: j.rows,
      title: j.title,
      credit: j.credit,
      placed: [...this.placed],
      total: j.cols * j.rows,
    };
  }

  // ---------- ヤマトの問題 ----------

  private scheduleYamato(at: number) {
    if (this.yamatoTimer) clearTimeout(this.yamatoTimer);
    this.yamatoTimer = null;
    if (!this.config?.yamato || this.status !== 'running') return;
    if (at + YAMATO_INTRO_MS + YAMATO_ANSWER_MS + 3000 > this.endsAt) return;
    this.yamatoTimer = setTimeout(() => {
      this.yamatoTimer = null;
      this.startYamato().catch((err) => console.error('❌ [live-game] yamato failed:', err?.message || String(err)));
      this.scheduleYamato(at + YAMATO_INTERVAL_MS);
    }, Math.max(0, at - Date.now()));
  }

  private async startYamato() {
    if (!this.isRunning() || !this.config) return;
    if (this.culture === null) {
      try {
        this.culture = await loadCultureQuiz(this.admin);
      } catch (err: any) {
        console.error('❌ [live-game] culture quiz load failed:', err?.message || String(err));
        this.culture = [];
      }
    }
    // 言葉の問題と文化クイズを交互に（文化クイズが無ければ言葉だけ）
    this.yamatoCount += 1;
    const useCulture = this.culture.length > 0 && this.yamatoCount % 2 === 0;
    const question = useCulture
      ? makeCultureQuestion(this.culture[randomInt(this.culture.length)])
      : makeQuestion(this.pool, this.config.questionSet, []);
    if (!question) return;

    const now = Date.now();
    const id = crypto.randomUUID();
    const opensAt = now + YAMATO_INTRO_MS;
    const round: YamatoRound = {
      id,
      question,
      opensAt,
      deadline: opensAt + YAMATO_ANSWER_MS,
      answered: new Set(),
      ranking: [],
      ended: false,
      timer: setTimeout(() => this.endYamato(id), YAMATO_INTRO_MS + YAMATO_ANSWER_MS + 300),
    };
    this.yamatoRound = round;
    for (const p of this.players.values()) if (p.name) this.sendYamatoStart(round, p.userId);
    this.scheduleHostUpdate();
  }

  private sendYamatoStart(round: YamatoRound, userId: string) {
    this.sendToUser(userId, {
      t: 'yamatoStart',
      roundId: round.id,
      question: toPublicQuestion(round.question),
      opensAt: round.opensAt,
      deadline: round.deadline,
      now: Date.now(),
      answered: round.answered.has(userId),
    });
  }

  private onYamatoAnswer(player: Player, msg: any) {
    const round = this.yamatoRound;
    if (!round || round.ended || msg.roundId !== round.id || !player.name) return;
    const now = Date.now();
    if (now > round.deadline || round.answered.has(player.userId)) return;
    if (now < round.opensAt + MIN_ANSWER_MS) return this.sendToUser(player.userId, { t: 'yamatoTooFast' });
    const choice = Number(msg.choice);
    if (!Number.isInteger(choice) || choice < 0 || choice >= round.question.options.length) return;

    round.answered.add(player.userId);
    const correct = choice === round.question.correctIndex;
    let rank: number | null = null;
    let reward = 0;
    if (correct) {
      round.ranking.push(player.userId);
      rank = round.ranking.length;
      reward = Math.max(0, YAMATO_TOP + 1 - rank);
      player.coins += reward;
    } else {
      player.missed[round.question.itemKey] = (player.missed[round.question.itemKey] ?? 0) + 1;
    }
    // 正解かどうかは本人にだけ。正解の番号は締め切りまで送らない
    this.sendToUser(player.userId, { t: 'yamatoAnswered', roundId: round.id, correct, rank, reward, coins: player.coins });
    this.scheduleHostUpdate();
  }

  private endYamato(roundId: string) {
    const round = this.yamatoRound;
    if (!round || round.id !== roundId || round.ended) return;
    round.ended = true;
    clearTimeout(round.timer);
    const top = round.ranking.slice(0, YAMATO_TOP).map((uid, i) => ({
      name: this.players.get(uid)?.name ?? '?',
      reward: YAMATO_TOP - i,
    }));
    for (const p of this.players.values()) {
      if (!p.name) continue;
      this.sendToUser(p.userId, { t: 'yamatoEnd', roundId, correctIndex: round.question.correctIndex, top, coins: p.coins });
    }
    this.addFeed(
      round.ranking.length
        ? `👁 Yamato's question — ${round.ranking.length} correct. Fastest: ${top[0].name}!`
        : `👁 Yamato's question — nobody got it this time.`
    );
    // 先生の画面には、しばらく正解と上位を出しておく
    setTimeout(() => {
      if (this.yamatoRound?.id === roundId) {
        this.yamatoRound = null;
        this.scheduleHostUpdate();
      }
    }, YAMATO_SHOW_RESULT_MS);
  }

  private yamatoHostState() {
    const round = this.yamatoRound;
    if (!round) return null;
    return {
      roundId: round.id,
      question: toPublicQuestion(round.question),
      opensAt: round.opensAt,
      deadline: round.deadline,
      ended: round.ended,
      correctIndex: round.ended ? round.question.correctIndex : null,
      answeredCount: round.answered.size,
      top: round.ranking.slice(0, YAMATO_TOP).map((uid, i) => ({
        name: this.players.get(uid)?.name ?? '?',
        reward: YAMATO_TOP - i,
      })),
    };
  }

  private addFeed(text: string) {
    this.feed = [{ at: Date.now(), text }, ...this.feed].slice(0, FEED_MAX);
    this.scheduleHostUpdate();
  }

  private sendToUser(userId: string, msg: unknown) {
    for (const [ws, s] of this.sessions) if (s.userId === userId) this.send(ws, msg);
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
        const kickedPlayer = this.players.get(userId);
        if (!kickedPlayer) return;
        this.players.delete(userId);
        if (kickedPlayer.duelId) this.resolveDuel(kickedPlayer.duelId);
        if (kickedPlayer.speedId) this.resolveSpeed(kickedPlayer.speedId, null);
        if (kickedPlayer.piece) this.returnPiece(kickedPlayer);
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
    this.scheduleSpeedRound(Date.now() + SPEED_FIRST_MS);
    this.scheduleYamato(Date.now() + YAMATO_FIRST_MS);

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
    if (this.speedTimer) clearTimeout(this.speedTimer);
    this.speedTimer = null;
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
      contributions: p.contributions,
    }));
    if (rows.length) {
      const { error } = await admin.from('edu_live_game_results').upsert(rows, { onConflict: 'game_id,user_id' });
      if (error) console.error('❌ [live-game] results save failed:', error.message);
    }
    const { error } = await admin
      .from('edu_live_games')
      .update({
        status: 'ended',
        ended_at: new Date().toISOString(),
        ...(this.isJigsaw() && this.config.jigsaw ? { completed: this.placed.size === this.config.jigsaw.cols * this.config.jigsaw.rows } : {}),
      })
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
      .sort((a, b) =>
        this.isJigsaw() ? b.contributions - a.contributions || b.correct - a.correct : b.coins - a.coins || b.correct - a.correct
      );
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
        contributions: p.contributions,
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
        janken: config.janken,
        speed: config.speed,
        yamato: config.yamato,
        mode: config.mode ?? 'coins',
      },
      jigsaw: this.jigsawBoard(),
      players,
      yamato: this.yamatoHostState(),
      classMissed,
      feed: this.feed,
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
      jankenCard: player.jankenCard,
      janken: config.janken,
      mode: config.mode ?? 'coins',
      contributions: player.contributions,
      jigsaw: this.jigsawBoard(),
    };
  }

  private studentFinal(player: Player) {
    const ranked = this.ranking();
    const rank = ranked.findIndex((p) => p.userId === player.userId) + 1;
    return {
      t: 'final',
      mode: this.config?.mode ?? 'coins',
      contributions: player.contributions,
      jigsaw: this.jigsawBoard(),
      coins: player.coins,
      correct: player.correct,
      answered: player.answered,
      rank: rank || null,
      total: ranked.length,
      top: ranked.slice(0, 5).map((p) => ({ name: p.name, coins: p.coins, contributions: p.contributions })),
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
