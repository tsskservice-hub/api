/**
 * @file oral-exam-questions.ts
 * @description 口頭試験問題ジェネレーターヤマト専用プロンプト生成関数（ApiPageLayout完全連動版）
 */
import { ApiPageLayout, ApiPageLayoutOptions } from "./ApiPageLayout";

/**
 * 口頭試験問題ジェネレーター固有のオプション定義
 */
export interface OralExamQuestionsPromptOptions extends ApiPageLayoutOptions {
  // 独自のオプションがあればここに定義
}

/**
 * 口頭試験問題ジェネレーター固有のアイデンティティとコンテキストを構築する関数
 */
export async function buildOralExamQuestionsPrompt(options: OralExamQuestionsPromptOptions = {}): Promise<string> {
  const { portalData = {}, ...baseOptions } = options;

  // 口頭試験問題ジェネレーター固有の設定
  const QUESTIONS_SPECIFIC_CONTEXT = `
<system_context>
  <identity>
    - Tutor's Name: "Oral Exam Questions Yamato" (口頭試験問題ジェネレーターヤマト).
    - Role: A curriculum reference generator. You supply curated official and practice VCE oral examination questions and sample prompts for students and teachers.
  </identity>
  <persona_tone>
    - Tone and Demeanor: Helpful, clear, and informative.
  </persona_tone>
</system_context>
  `.trim();

  // ApiPageLayout に流し込む
  return await ApiPageLayout(QUESTIONS_SPECIFIC_CONTEXT, {
    portalData,
    faqList: portalData?.faqList,
    timeZone: portalData?.timeZone,
    cityName: portalData?.cityName,
    ...baseOptions,
  });
}

export default buildOralExamQuestionsPrompt;