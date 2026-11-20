/**
 * @file src/world/plaza-rules.ts
 * @description Yamato Town の「みんなで（Together）」モードの決まり（サーバー専用）
 *
 * 子どもを守る決まり（2026-11-21 に決定。SQL 58）:
 *   ・ほかの人とのやりとりは、ここにある決まった日本語の文とスタンプだけ。端末は番号しか送れない
 *     （自由なチャット・人どうしの声・個別メッセージ・フレンドはない）
 *   ・名前は、つなぐたびにここで作るランダムの町の名前。本名・ニックネームは出さない
 *   ・学校のアカウント（先生・クラスの生徒・クラスに申請中の人）は入れない
 *   ・決まりへの同意（18 歳未満は保護者の許可）がない人は入れない
 *   ・管理者が止めた人、7 日以内に 3 人以上から報告された人（確認前）は入れない
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { WORLD_PLACES } from './places';

/** 決まりの版。文を大きく変えたら上げる（もう一度同意してもらう）。ポータルの PLAZA_RULES_VERSION と同じにする */
export const PLAZA_RULES_VERSION = 1;
/** 1 つの部屋に入れる人数 */
export const ROOM_CAPACITY = 20;
/** 1 つの場所に作る部屋の数（いっぱいなら次の部屋へ） */
export const MAX_ROOMS_PER_PLACE = 5;

/** 決まった文（端末は番号だけを送る） */
export const PLAZA_PHRASES: { ja: string; en: string }[] = [
  { ja: 'こんにちは！', en: 'Hello!' },
  { ja: 'はじめまして。', en: 'Nice to meet you.' },
  { ja: 'よろしく おねがいします。', en: 'Nice to meet you. (Please be kind to me.)' },
  { ja: 'なにを たべますか。', en: 'What will you eat?' },
  { ja: 'ハンバーガーが すきです。', en: 'I like hamburgers.' },
  { ja: 'おいしそう！', en: 'Looks tasty!' },
  { ja: 'がんばって！', en: 'Good luck!' },
  { ja: 'すごい！', en: 'Amazing!' },
  { ja: 'ありがとう！', en: 'Thank you!' },
  { ja: 'いっしょに れんしゅうしましょう。', en: "Let's practise together." },
  { ja: 'またね！', en: 'See you!' },
  { ja: 'さようなら。', en: 'Goodbye.' },
];

/** スタンプ */
export const PLAZA_STAMPS = ['👋', '👍', '😊', '😆', '👏', '🎉', '🍔', '🙇'];

/** アバター（ポータルの WorldScene の AVATARS と同じ順） */
export const PLAZA_AVATARS = ['🧑‍🎓', '👩‍🎓', '👨‍🎓', '🐱', '🐶', '🦊'];

/** 町の名前のもと（＋ 2 けたの数字） */
const NAME_WORDS = ['たぬき', 'きつね', 'うさぎ', 'ねこ', 'いぬ', 'くま', 'パンダ', 'ペンギン', 'りす', 'コアラ', 'カンガルー', 'ふくろう', 'いるか', 'かめ'];

export const REPORT_REASONS = ['spam', 'following', 'unkind', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

/** 部屋の名前（Durable Object の名前）。場所と番号が正しいときだけ */
export function plazaRoomName(place: string, room: number): string | null {
  if (!WORLD_PLACES[place]) return null;
  if (!Number.isInteger(room) || room < 1 || room > MAX_ROOMS_PER_PLACE) return null;
  return `${place}:${room}`;
}

/** 部屋の中で重ならない、ランダムの町の名前 */
export function makeTownName(taken: Set<string>): string {
  for (let i = 0; i < 50; i++) {
    const word = NAME_WORDS[Math.floor(Math.random() * NAME_WORDS.length)];
    const name = `${word} ${10 + Math.floor(Math.random() * 90)}`;
    if (!taken.has(name)) return name;
  }
  return `ともだち ${100 + Math.floor(Math.random() * 900)}`;
}

export type PlazaStatus = 'OK' | 'NOT_AGREED' | 'SCHOOL_ACCOUNT' | 'SUSPENDED' | 'SERVER_ERROR';

/** 7 日以内に、確認前の報告をした人の数がこれ以上なら、確認するまで入れない */
const AUTO_SUSPEND_REPORTERS = 3;

/** この人が「みんなで」モードに入れるか（部屋に入るたびにも確かめる） */
export async function plazaStatus(admin: SupabaseClient, userId: string): Promise<PlazaStatus> {
  try {
    const school = await isSchoolAccount(admin, userId);
    if (school) return 'SCHOOL_ACCOUNT';
    if (await isSuspended(admin, userId)) return 'SUSPENDED';
    const { data: consent, error } = await admin
      .from('world_plaza_consents')
      .select('rules_version')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    if (!consent || Number(consent.rules_version) < PLAZA_RULES_VERSION) return 'NOT_AGREED';
    return 'OK';
  } catch (err: any) {
    console.error('❌ [plaza] status check failed:', err?.message || String(err));
    return 'SERVER_ERROR';
  }
}

/** 先生（承認済み・申請中）、クラスの生徒、クラスに申請中の人 */
async function isSchoolAccount(admin: SupabaseClient, userId: string): Promise<boolean> {
  const [profile, member, request] = await Promise.all([
    admin.from('profiles').select('is_teacher, teacher_status').eq('id', userId).maybeSingle(),
    admin.from('edu_class_members').select('user_id').eq('user_id', userId).limit(1),
    admin.from('edu_class_join_requests').select('user_id').eq('user_id', userId).limit(1),
  ]);
  if (profile.error) throw profile.error;
  if (member.error) throw member.error;
  if (request.error) throw request.error;
  const p = profile.data as { is_teacher?: boolean; teacher_status?: string | null } | null;
  if (p?.is_teacher || p?.teacher_status === 'approved' || p?.teacher_status === 'pending') return true;
  return (member.data?.length ?? 0) > 0 || (request.data?.length ?? 0) > 0;
}

/** 管理者が止めた人、報告がたまった人 */
export async function isSuspended(admin: SupabaseClient, userId: string): Promise<boolean> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const [ban, reports] = await Promise.all([
    admin.from('world_plaza_bans').select('until').eq('user_id', userId).maybeSingle(),
    admin
      .from('world_plaza_reports')
      .select('reporter_id')
      .eq('reported_id', userId)
      .is('reviewed_at', null)
      .gt('created_at', since)
      .limit(200),
  ]);
  if (ban.error) throw ban.error;
  if (reports.error) throw reports.error;
  if (ban.data && (!ban.data.until || new Date(String(ban.data.until)).getTime() > Date.now())) return true;
  const reporters = new Set((reports.data ?? []).map((r: any) => r.reporter_id).filter(Boolean));
  return reporters.size >= AUTO_SUSPEND_REPORTERS;
}
