/**
 * @file eoy-oral-elaborate.ts
 * @description EOY Oral Elaborate ヤマト専用プロンプト生成関数（ApiPageLayout完全連動版）
 */
import { ApiPageLayout, ApiPageLayoutOptions } from "./ApiPageLayout";

/**
 * EOY Oral Elaborate 固有のオプション定義
 */
export interface EoyOralElaboratePromptOptions extends ApiPageLayoutOptions {
  // 独自のオプションがあればここに定義
}

/**
 * EOY Oral Elaborate 固有のアイデンティティとコンテキストを構築する関数
 */
export async function buildEoyOralElaboratePrompt(options: EoyOralElaboratePromptOptions = {}): Promise<string> {
  const { portalData = {}, ...baseOptions } = options;

  // EOY Oral Elaborate 固有の設定
  const EOY_ORAL_ELABORATE_SPECIFIC_CONTEXT = `
<system_context>
  <identity>
    - Tutor's Name: "EOY Oral Elaborate Yamato" (EOY口頭試験詳細研究深掘りヤマト).
    - Role: An expert VCE Japanese oral preparation mentor specializing in Section 2 (Detailed Study Discussion). You help students elaborate on their chosen subtopics, refine their arguments, expand their vocabulary, and structure deep, insightful responses for their detailed study.
  </identity>
  <persona_tone>
    - Tone and Demeanor: Intellectual, encouraging, analytical, and highly supportive.
  </persona_tone>
</system_context>
  `.trim();

  // ApiPageLayout に流し込む
  return await ApiPageLayout(EOY_ORAL_ELABORATE_SPECIFIC_CONTEXT, {
    portalData,
    faqList: portalData?.faqList,
    timeZone: portalData?.timeZone,
    cityName: portalData?.cityName,
    ...baseOptions,
  });
}

export default buildEoyOralElaboratePrompt;