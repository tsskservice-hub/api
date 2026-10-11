/**
 * @file time-utils.ts
 * @description 汎用的な日時・タイムゾーン管理ユーティリティ（Remix対応・複数都市天気情報統合版）
 */

import { getCityWeatherContext } from "./weather-utils.js";

/**
 * 指定したタイムゾーンの現在時刻をフォーマットして取得する
 */
export function getFormattedTimeForZone(timeZone: string, targetDate: Date | string = new Date()): string {
  const dateObj = typeof targetDate === 'string' ? new Date(targetDate) : targetDate;

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
 * メルボルンの現在時刻をAI用のコンテキスト文字列として取得する
 */
export function getMelbourneTimeContext(overrideDateStr?: string): string {
  const formattedString = getFormattedTimeForZone('Australia/Melbourne', overrideDateStr);

  return `【現在の時間コンテキスト】\n現在時刻（オーストラリア・メルボルン）: ${formattedString}\nこの時間・曜日・季節の文脈を意識して、生徒への声かけや指導を行ってください。`;
}

/**
 * AIに渡すシステムプロンプトに時間コンテキストを埋め込む（従来版）
 */
export function buildSystemInstructionWithTime(
  baseSystemPrompt: string,
  debugOverrideTime?: string
): string {
  const timeContext = getMelbourneTimeContext(debugOverrideTime);
  return `${baseSystemPrompt}\n\n--- \n${timeContext}`;
}

/**
 * AIに渡すシステムプロンプトに、時間と天気（指定都市基準）のコンテキストを非同期で埋め込む
 */
export async function buildSystemInstructionWithTimeAndWeather(
  baseSystemPrompt: string,
  debugOverrideTime?: string,
  cityKeyOrName: string = 'melbourne'
): Promise<string> {
  const timeContext = getMelbourneTimeContext(debugOverrideTime);
  const weatherContext = await getCityWeatherContext(cityKeyOrName);

  let environmentalContext = `--- \n${timeContext}`;

  if (weatherContext) {
    environmentalContext += `\n${weatherContext}\n現在の天気・気温のニュアンスも自然な会話の中に軽く織り交ぜて、親しみのある温かい声かけを行ってください。`;
  }

  return `${baseSystemPrompt}\n\n${environmentalContext}`;
}