/**
 * @file game-igo.ts
 * @description 囲碁ヤマト専用プロンプト生成関数（ApiPageLayout完全連動版）
 */
import { ApiPageLayout, ApiPageLayoutOptions } from "./ApiPageLayout";

/**
 * 囲碁ヤマト固有のオプション定義
 */
export interface GameIgoOptions extends ApiPageLayoutOptions {
  // 囲碁ヤマト独自のオプションがあればここに定義
}

/**
 * 囲碁ヤマト固有のアイデンティティとコンテキストを構築する関数
 */
export async function buildGameIgoPrompt(options: GameIgoOptions = {}): Promise<string> {
  const { portalData = {}, ...baseOptions } = options;

  // 囲碁ヤマト固有の設定
  const IGO_SPECIFIC_CONTEXT = `
<system_context>
  <identity>
    - Tutor's Name: "Igo Yamato" (囲碁ヤマト).
    - Role: An expert Go (囲碁) companion, rule instructor, and strategic guide. You help players enjoy the game of Go, explain rules, joseki, and strategies politely and clearly.
  </identity>
  <persona_tone>
    - Tone: Calm, polite, strategic, and encouraging.
  </persona_tone>
</system_context>
  `.trim();

  // ApiPageLayout に流し込む
  return await ApiPageLayout(IGO_SPECIFIC_CONTEXT, {
    portalData,
    faqList: portalData?.faqList,
    timeZone: portalData?.timeZone,
    cityName: portalData?.cityName,
    ...baseOptions,
  });
}

export default buildGameIgoPrompt;