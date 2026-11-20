/**
 * @file credit-rules.ts
 * @description サーバーサイド用：機能ごとの最大予想消費クレジット数（キャップ）の定義と機能判定・検証ヘルパー
 */

// 💡 公開している料金表（Credit Consumption Guide）と同じ数字にする。変えるときは料金表（Supabase の PRICE_PLANS）も一緒に変える
export const SERVER_CREDIT_COSTS = {
  textAi: 2,         // Text Chat: 2 credits / turn
  imageAi: 4,        // Image Attachment (1) / 画像生成: 4 credits
  multiImageAi: 6,   // Image Attachments (2 to 4): 6 credits
  voiceDrill: 4,     // Voice AI: EOY Oral Drill: 4 credits / question
  voiceElaborate: 8, // Voice AI: EOY Oral Elaborate: 8 credits / question
  mockSection1: 15,  // Voice AI: Mock Section 1 (approx. 7 min): 15 credits / mock
  mockSection2: 15,  // Voice AI: Mock Section 2 (approx. 8 min): 15 credits / mock
  mockFull: 25,      // Voice AI: Full Mock (approx. 15 min): 25 credits / mock
  realtime5: 25,     // Voice AI: EOY Oral Superb（Realtime の自由会話）5 分
  realtime10: 50,    // Voice AI: EOY Oral Superb（Realtime の自由会話）10 分
  worldTalk3: 15,    // Voice AI: Yamato Town（お店の店員などと話す）3 分。Superb と同じ 1 分 5 クレジット（仮）
  kanjiLookup: 1,    // 漢字AI検索: 1 日 20 回まで無料、それを超えたら 1 回 1 クレジット（handlers/kanji-lookup-handler.ts）
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
 * リクエストの内容から、どの機能（料金区分）かを決める
 * 🔐 ブラウザが送る featureKey は使わない（安い区分を名乗って払う額を減らせてしまうため）。
 *    appType（＝どの AI 指示を使うか）を最優先にし、isVoiceMode / isMock* は appType で決まらないときだけ使う
 */
export function determineFeatureKeyFromPayload(body: {
  requestVisualAid?: boolean;
  appType?: string;
  isMockFull?: boolean;
  isMockSection?: "1" | "2";
  isVoiceMode?: "drill" | "elaborate";
  imageBase64?: string;
  questionImageBase64?: string;
  questionImagesBase64?: string[];
}): FeatureKey {
  const appType = body.appType || "";

  // 1. appType で決まるもの（AI 指示と料金区分を必ず一致させる）
  if (appType === "eoy-oral-drill") return "voiceDrill";
  if (appType === "eoy-oral-elaborate") return "voiceElaborate";
  if (appType === "eoy-oral-mock-full") return "mockFull";
  if (appType === "eoy-oral-mock-section1") return "mockSection1";
  if (appType === "eoy-oral-mock-section2") return "mockSection2";
  if (appType === "eoy-oral-superb-5") return "realtime5";
  if (appType === "eoy-oral-superb-10") return "realtime10";
  if (appType === "world-talk-3") return "worldTalk3";

  // 2. 旧形式のフラグ
  if (body.isMockFull) return "mockFull";
  if (body.isMockSection === "1") return "mockSection1";
  if (body.isMockSection === "2") return "mockSection2";
  if (body.isVoiceMode === "elaborate") return "voiceElaborate";
  if (body.isVoiceMode === "drill") return "voiceDrill";

  // 3. 画像
  if (body.requestVisualAid) return "imageAi";
  let totalImagesCount = 0;
  if (Array.isArray(body.questionImagesBase64)) totalImagesCount += body.questionImagesBase64.length;
  if (body.questionImageBase64) totalImagesCount += 1;
  if (body.imageBase64) totalImagesCount += 1;
  if (totalImagesCount >= 2) return "multiImageAi";
  if (totalImagesCount === 1) return "imageAi";

  // 4. それ以外は通常のテキストチャット
  return "textAi";
}

/**
 * リクエストに必要なクレジット数
 */
export function determineRequiredCreditsFromPayload(body: Parameters<typeof determineFeatureKeyFromPayload>[0]): number {
  return SERVER_CREDIT_COSTS[determineFeatureKeyFromPayload(body)];
}
