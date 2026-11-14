/**
 * @file handwriting-cleanup.ts
 * @description 保存期間が過ぎた手書きの写真を、非公開バケットから毎日消す（Cron Trigger から呼ぶ）
 *
 * - レッスンの手書き課題では、クラスの先生が保存期間を選んだときだけ写真を保存し、image_delete_after に消す日時を記録している
 *   （textbook-lesson-writing-handler.ts）。ここでその日時を過ぎた写真のファイルを消し、image_deleted_at を記録する
 * - プライバシーポリシー（5 章）と FAQ で「先生が選んだ期間（最大 180 日）が過ぎたら消す」と約束しているので、その実体
 * - 読み取った文字（transcription）は消さない（再提出の回数と先生の確認に使う）
 */
import { getSupabaseAdmin } from './supabase-admin';

const IMAGE_BUCKET = 'writing-submissions';
const BATCH_SIZE = 100;
const MAX_BATCHES = 20; // 1 回の実行で最大 2,000 件。残りは次の日に消す
const LOG_PREFIX = '[handwriting-cleanup]';

export async function deleteExpiredHandwritingImages(env: unknown): Promise<number> {
  const admin = getSupabaseAdmin(env);
  const now = new Date().toISOString();
  let deleted = 0;

  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const { data: rows, error } = await admin
      .from('edu_writing_submissions')
      .select('id, image_path')
      .not('image_path', 'is', null)
      .is('image_deleted_at', null)
      .lte('image_delete_after', now)
      .limit(BATCH_SIZE);

    if (error) {
      console.error(`${LOG_PREFIX} could not list expired images:`, error.message);
      break;
    }
    if (!rows || rows.length === 0) break;

    const paths = rows.map((r: { image_path: string }) => r.image_path);
    const { error: removeError } = await admin.storage.from(IMAGE_BUCKET).remove(paths);
    if (removeError) {
      // ファイルを消せなかったときは記録を変えない（次の日にもう一度試す）
      console.error(`${LOG_PREFIX} could not delete images:`, removeError.message);
      break;
    }

    const { error: updateError } = await admin
      .from('edu_writing_submissions')
      .update({ image_deleted_at: now, image_path: null })
      .in('id', rows.map((r: { id: string }) => r.id));
    if (updateError) {
      console.error(`${LOG_PREFIX} images deleted but rows not updated:`, updateError.message);
      break;
    }

    deleted += rows.length;
    if (rows.length < BATCH_SIZE) break;
  }

  console.log(`${LOG_PREFIX} deleted ${deleted} expired handwriting image(s).`);

  const orphans = await deleteQueuedHandwritingImages(admin);
  return deleted + orphans;
}

/**
 * 記録ごと消えた写真（アカウント削除など）を消す。
 * 写真付きの記録が消えると、データベースのトリガーが edu_image_deletion_queue に場所を入れる
 * （yamato-portal/supabase/sql/20_handwriting_image_deletion_queue.sql）
 */
async function deleteQueuedHandwritingImages(admin: ReturnType<typeof getSupabaseAdmin>): Promise<number> {
  let deleted = 0;

  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const { data: rows, error } = await admin
      .from('edu_image_deletion_queue')
      .select('path')
      .order('queued_at', { ascending: true })
      .limit(BATCH_SIZE);

    if (error) {
      // 20 の SQL をまだ実行していないときもここに来る。期限切れの写真の削除には影響しない
      console.error(`${LOG_PREFIX} could not read the deletion queue:`, error.message);
      break;
    }
    if (!rows || rows.length === 0) break;

    const paths = rows.map((r: { path: string }) => r.path);
    const { error: removeError } = await admin.storage.from(IMAGE_BUCKET).remove(paths);
    if (removeError) {
      console.error(`${LOG_PREFIX} could not delete queued images:`, removeError.message);
      break;
    }

    const { error: dequeueError } = await admin.from('edu_image_deletion_queue').delete().in('path', paths);
    if (dequeueError) {
      console.error(`${LOG_PREFIX} queued images deleted but queue not cleared:`, dequeueError.message);
      break;
    }

    deleted += rows.length;
    if (rows.length < BATCH_SIZE) break;
  }

  console.log(`${LOG_PREFIX} deleted ${deleted} handwriting image(s) whose records were removed.`);
  return deleted;
}
