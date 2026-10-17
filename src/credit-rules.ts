/**
 * @file credit-rules.ts
 * @description サーバーサイド用：機能ごとの最大予想消費クレジット数（キャップ）の定義と機能判定・検証ヘルパー
 */

export const SERVER_CREDIT_COSTS = {
  textAi: 2,         // コンシェルジュ・チャット等のテキストAI
  imageAi: 4,        // 画像生成・原稿用紙AIレイアウト等 (imagen-service.ts などで使用)
  voiceDrill: 3,     // eoy-oral-drill.ts (音声の一問一答ドリル)
  voiceElaborate: 4, // eoy-oral-elaborate.ts (音声の詳細応答・発展学習)
  mockSection1: 6,   // eoy-oral-mock.ts (Section 1: 約7分間のセクション)
  mockSection2: 6,   // eoy-oral-mock.ts (Section 2: 約8分間のセクション)
  mockFull: 10,      // eoy-oral-mock.ts (フル通し模試: 約15分間のフル試問)
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

/**
 * リクエストのペイロードや appType から、どの機能（FeatureKey）に該当するかを自動判定して必要なクレジット数を算出するヘルパー
 * @param body APIリクエストのボディ
 * @returns 必要なクレジット数
 */
export function determineRequiredCreditsFromPayload(body: {
  requestVisualAid?: boolean;
  appType?: string;
  featureKey?: FeatureKey;
  isMockFull?: boolean;
  isMockSection?: "1" | "2";
  isVoiceMode?: "drill" | "elaborate";
}): number {
  // 1. 明示的に featureKey が指定されている場合
  if (body.featureKey && SERVER_CREDIT_COSTS[body.featureKey]) {
    return SERVER_CREDIT_COSTS[body.featureKey];
  }

  // 2. モードや appType に応じた判定
  if (body.isMockFull || body.appType === "eoy-oral-mock-full") {
    return SERVER_CREDIT_COSTS.mockFull;
  }
  if (body.isMockSection === "1" || body.appType === "eoy-oral-mock-section1") {
    return SERVER_CREDIT_COSTS.mockSection1;
  }
  if (body.isMockSection === "2" || body.appType === "eoy-oral-mock-section2") {
    return SERVER_CREDIT_COSTS.mockSection2;
  }
  if (body.isVoiceMode === "drill" || body.appType === "eoy-oral-drill") {
    return SERVER_CREDIT_COSTS.voiceDrill;
  }
  if (body.isVoiceMode === "elaborate" || body.appType === "eoy-oral-elaborate") {
    return SERVER_CREDIT_COSTS.voiceElaborate;
  }
  if (body.requestVisualAid) {
    return SERVER_CREDIT_COSTS.imageAi;
  }

  // 3. デフォルトは通常のテキストAIチャット
  return SERVER_CREDIT_COSTS.textAi;
}