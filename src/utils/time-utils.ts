/**
 * @file time-utils.ts
 * @description 汎用的な日時・タイムゾーン管理ユーティリティ（FoundationLayout層連携・シンプル最適化版）
 */

/**
 * 指定したタイムゾーンの現在時刻をフォーマットして取得する
 */
export function getFormattedTimeForZone(timeZone: string, targetDate: Date | string = new Date()): string {
  // 常に最新の実行時現在時刻を取得できるよう強制的に新規Dateオブジェクトを生成
  const dateObj = !targetDate || targetDate instanceof Date ? new Date() : new Date(targetDate);

  const formatter = new Intl.DateTimeFormat('ja-JP', {
    timeZone: timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  return formatter.format(dateObj);
}

/**
 * チャットシステムなどの要求に合わせて現在時刻文字列を取得するヘルパー関数
 */
export function getCurrentTimeString(cityKeyOrZone: string = 'Australia/Melbourne', overrideDateStr?: string): string {
  const zone = cityKeyOrZone.includes('/') ? cityKeyOrZone : 'Australia/Melbourne';
  return getFormattedTimeForZone(zone, overrideDateStr);
}

/**
 * メルボルンの現在時刻をAI用のコンテキスト文字列として取得する
 */
export function getMelbourneTimeContext(overrideDateStr?: string): string {
  const formattedString = getFormattedTimeForZone('Australia/Melbourne', overrideDateStr);

  return `【現在の時間コンテキスト】\n現在時刻（オーストラリア・メルボルン）: ${formattedString}\nこの時間・曜日・季節の文脈を意識して、生徒への声かけや指導を行ってください。`;
}