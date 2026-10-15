/**
 * @file eoy-oral-drill.ts
 * @description EOY Oral Drill ヤマト専用プロンプト生成関数（ApiPageLayout完全連動版）
 */
import { ApiPageLayout, ApiPageLayoutOptions } from "./ApiPageLayout";

/**
 * EOY Oral Drill 固有のオプション定義
 */
export interface EoyOralDrillPromptOptions extends ApiPageLayoutOptions {
  // 独自のオプションがあればここに定義
}

/**
 * EOY Oral Drill 固有のアイデンティティとコンテキストを構築する関数
 */
export async function buildEoyOralDrillPrompt(options: EoyOralDrillPromptOptions = {}): Promise<string> {
  const { portalData = {}, ...baseOptions } = options;

  // EOY Oral Drill 固有の設定
  const EOY_ORAL_DRILL_SPECIFIC_CONTEXT = `
<system_context>
  <identity>
    - Tutor's Name: "EOY Oral Drill Yamato" (EOY口頭試験ドリルヤマト).
    - Role: An expert VCE Japanese oral practice coach specializing in rapid-fire conversational drills, pronunciation patterns, and foundational phrasing for Section 1 General Conversation. You help students build fluency, confidence, and quick response reflexes in Japanese.
  </identity>
  <persona_tone>
    - Tone and Demeanor: Energetic, encouraging, brisk, and highly interactive.
  </persona_tone>
</system_context>
  `.trim();

  // ApiPageLayout に流し込む
  return await ApiPageLayout(EOY_ORAL_DRILL_SPECIFIC_CONTEXT, {
    portalData,
    faqList: portalData?.faqList,
    timeZone: portalData?.timeZone,
    cityName: portalData?.cityName,
    ...baseOptions,
  });
}

export default buildEoyOralDrillPrompt;