/**
 * @file src/services/oral-timing.ts
 * @description 口頭試験の練習（mock・superb）で、画面が測った「時間」から、すらすら話せているかの数字をまとめる
 *
 * AI の推測ではなく、プログラムが測った数字（フィードバックの AI にそのまま渡す）:
 *   ・答え始めるまでの秒数（試験官／ヤマトが話し終えてから、生徒が話し始めるまで）
 *   ・1 回の答えを話した秒数
 *   ・1 分あたりに話した文字数（文字にしたものの文字数 ÷ 話した時間）
 * 発音・抑揚は分からない。テンポの一部（答え始めの速さ・話す量）だけ
 */

export interface TimedLine {
  speaker: string;
  text: string;
  /** 答え始めるまでの秒数（分からなければ undefined） */
  latency?: number;
  /** 話した秒数（分からなければ undefined） */
  duration?: number;
}

/** 画面から来た数字を、0〜max の秒（小数 1 桁）にする。おかしな値は捨てる */
export function cleanSeconds(value: unknown, max: number): number | undefined {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > max) return undefined;
  return Math.round(n * 10) / 10;
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/**
 * 数字のまとめ（AI に渡す文）。測れた答えが 2 つ未満なら null（数字で言えることがない）
 * @param recordKeyNote mock は録音キーを押してから話すので、その分の注意を書く
 */
export function summarizeTiming(lines: TimedLine[], recordKeyNote = false): string | null {
  const answers = lines.filter((l) => l.speaker === 'student');
  const latencies = answers.map((a) => a.latency).filter((x): x is number => typeof x === 'number');
  const durations = answers.map((a) => a.duration).filter((x): x is number => typeof x === 'number');
  if (latencies.length < 2 && durations.length < 2) return null;

  const quick = latencies.filter((x) => x <= 3).length;
  const longPauses = latencies.filter((x) => x >= 8).length;
  // 話す速さは、2 秒以上話した答えだけで計る（短すぎると数字がぶれる）
  const timed = answers.filter((a) => typeof a.duration === 'number' && (a.duration as number) >= 2);
  const chars = timed.reduce((s, a) => s + a.text.replace(/[\s、。，．,.!?！？「」]/g, '').length, 0);
  const secs = timed.reduce((s, a) => s + (a.duration as number), 0);
  const perMinute = secs > 0 ? Math.round((chars / secs) * 60) : null;

  const out = [
    `Answers measured: ${Math.max(latencies.length, durations.length)}`,
    latencies.length
      ? `Time to start answering: average ${avg(latencies).toFixed(1)} s; started within 3 s in ${quick} of ${latencies.length} answers; long pauses (8 s or more) before ${longPauses} answers`
      : '',
    durations.length
      ? `Length of each answer: average ${avg(durations).toFixed(1)} s (shortest ${Math.min(...durations).toFixed(1)} s, longest ${Math.max(...durations).toFixed(1)} s); total speaking time ${Math.round(durations.reduce((a, b) => a + b, 0))} s`
      : '',
    perMinute !== null ? `Amount said: about ${perMinute} Japanese characters per minute of speaking (from the transcript)` : '',
    recordKeyNote
      ? 'Note: in this mode the student presses a key to start recording, so "time to start answering" includes about 1 second for that.'
      : '',
  ].filter(Boolean);
  return out.join('\n');
}
