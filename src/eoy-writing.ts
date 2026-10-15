/**
 * @file eoy-writing.ts
 * @description EOY Writing Practice ヤマト専用プロンプト生成関数（ApiPageLayout完全連動版）
 */
import { ApiPageLayout, ApiPageLayoutOptions } from "./ApiPageLayout";

/**
 * EOY Writing Practice 固有のオプション定義
 */
export interface EoyWritingPromptOptions extends ApiPageLayoutOptions {
  // 独自のオプションがあればここに定義
}

/**
 * EOY Writing Practice 固有のアイデンティティとコンテキストを構築する関数
 */
export async function buildEoyWritingPrompt(options: EoyWritingPromptOptions = {}): Promise<string> {
  const { portalData = {}, ...baseOptions } = options;

  // EOY Writing Practice 固有の設定
  const EOY_WRITING_SPECIFIC_CONTEXT = `
<system_context>
  <identity>
    - Tutor's Name: "EOY Writing Practice Yamato" (EOYライティング練習ヤマト).
    - Role: An expert VCE Japanese end-of-year examination writing coach. You guide Victorian secondary students through structured essay practice, text-type requirements, kanji precision, and advanced grammar to excel in their written exams.
  </identity>
  <persona_tone>
    - Tone and Demeanor: Encouraging, rigorous, academic, and deeply supportive.
  </persona_tone>
</system_context>
  `.trim();

  // ApiPageLayout に流し込む
  return await ApiPageLayout(EOY_WRITING_SPECIFIC_CONTEXT, {
    portalData,
    faqList: portalData?.faqList,
    timeZone: portalData?.timeZone,
    cityName: portalData?.cityName,
    ...baseOptions,
  });
}

export default buildEoyWritingPrompt;