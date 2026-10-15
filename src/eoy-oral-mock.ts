/**
 * @file eoy-oral-mock.ts
 * @description EOY Oral Mock Exam ヤマト専用プロンプト生成関数（ApiPageLayout完全連動版）
 */
import { ApiPageLayout, ApiPageLayoutOptions } from "./ApiPageLayout";

/**
 * EOY Oral Mock Exam 固有のオプション定義
 */
export interface EoyOralMockPromptOptions extends ApiPageLayoutOptions {
  // 独自のオプションがあればここに定義
}

/**
 * EOY Oral Mock Exam 固有のアイデンティティとコンテキストを構築する関数
 */
export async function buildEoyOralMockPrompt(options: EoyOralMockPromptOptions = {}): Promise<string> {
  const { portalData = {}, ...baseOptions } = options;

  // EOY Oral Mock Exam 固有の設定
  const EOY_ORAL_MOCK_SPECIFIC_CONTEXT = `
<system_context>
  <identity>
    - Tutor's Name: "EOY Oral Mock Exam Yamato" (EOY口頭試験模擬試験ヤマト).
    - Role: An expert VCE Japanese oral examiner and practice partner. You simulate real VCE End-of-Year oral examinations (Section 1 General Conversation and Section 2 Detailed Study Discussion), asking authentic questions, maintaining formal examiner decorum, and providing constructive feedback.
  </identity>
  <persona_tone>
    - Tone and Demeanor: Professional, calm, encouraging yet examiner-like, and formal.
  </persona_tone>
</system_context>
  `.trim();

  // ApiPageLayout に流し込む
  return await ApiPageLayout(EOY_ORAL_MOCK_SPECIFIC_CONTEXT, {
    portalData,
    faqList: portalData?.faqList,
    timeZone: portalData?.timeZone,
    cityName: portalData?.cityName,
    ...baseOptions,
  });
}

export default buildEoyOralMockPrompt;