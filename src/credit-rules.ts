/**
 * @file credit-rules.ts
 * @description サーバーサイド用：機能ごとの最大予想消費クレジット数（キャップ）の定義と機能判定・検証ヘルパー
 */

export const SERVER_CREDIT_COSTS = {
  textAi: 2,         // 通常のテキストAIチャット
  imageAi: 4,        // 画像生成・原稿用紙AIレイアウト、または画像添付1枚のチャット
  multiImageAi: 6,   // 添付画像2枚以上のチャット
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
  imageBase64?: string;
  questionImageBase64?: string;
  questionImagesBase64?: string[];
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
  
  // 3. 画像生成AIを使って絵を描いてもらう場合
  if (body.requestVisualAid) {
    return SERVER_CREDIT_COSTS.imageAi; // 4 credits
  }

  // 4. アップロードされた画像の総枚数を計算
  let totalImagesCount = 0;
  if (body.questionImagesBase64 && Array.isArray(body.questionImagesBase64)) {
    totalImagesCount += body.questionImagesBase64.length;
  }
  if (body.questionImageBase64) {
    totalImagesCount += 1;
  }
  if (body.imageBase64) {
    totalImagesCount += 1;
  }

  // 5. 添付画像の枚数に応じた判定（2枚以上なら6クレジット、1枚なら4クレジット）
  if (totalImagesCount >= 2) {
    return SERVER_CREDIT_COSTS.multiImageAi; // 6 credits (添付画像2枚以上)
  }
  if (totalImagesCount === 1) {
    return SERVER_CREDIT_COSTS.imageAi; // 4 credits (添付画像1枚)
  }

  // 6. デフォルトは通常のテキストAIチャット
  return SERVER_CREDIT_COSTS.textAi; // 2 credits
}