/**
 * @file credit-rules.ts
 * @description サーバーサイド用：機能ごとの最大予想消費クレジット数（キャップ）の定義とヘルパー
 */

export const SERVER_CREDIT_COSTS = {
  textAi: 2,         // コンシェルジュ・チャット等のテキストAI
  imageAi: 4,        // 画像生成・原稿用紙AIレイアウト等 (imagen-service.ts などで使用)
  voiceDrill: 3,     // eoy-oral-drill.ts
  voiceElaborate: 4, // eoy-oral-elaborate.ts
  mockSection1: 6,   // eoy-oral-mock.ts (Section 1)
  mockSection2: 6,   // eoy-oral-mock.ts (Section 2)
  mockFull: 10,      // eoy-oral-mock.ts (全部通し)
} as const;

export type FeatureKey = keyof typeof SERVER_CREDIT_COSTS;

/**
 * 指定された機能に必要なクレジット数を安全に取得するヘルパー関数
 * @param feature 機能のキー (FeatureKey)
 * @returns 必要なクレジット数 (デフォルトは textAi の 2)
 */
export function getRequiredCredits(feature: FeatureKey): number {
  return SERVER_CREDIT_COSTS[feature] ?? 2;
}