/**
 * @file oral-exam-questions.ts
 * @description 口頭試験問題ジェネレーターヤマト専用プロンプト生成関数（YamatoApiCommon・portalData完全排除・同期ナレッジ対応版）
 */
import { YamatoApiCommon, YamatoApiCommonOptions } from "./YamatoApiCommon";
import { getSyncedKnowledge } from "./sync-knowledge"; // 💡 API側の同期済みナレッジをインポート

/**
 * 口頭試験問題ジェネレーター固有のオプション定義（portalDataを排除）
 */
export interface OralExamQuestionsPromptOptions extends YamatoApiCommonOptions {
  timeZone?: string;
  cityName?: string;
}

/**
 * 口頭試験問題ジェネレーター固有のアイデンティティとコンテキストを構築する関数
 */
export async function buildOralExamQuestionsPrompt(options: OralExamQuestionsPromptOptions = {}): Promise<string> {
  const { ...baseOptions } = options;

  // 💡 API側の同期済みナレッジ（syncedKnowledge）からFAQを取得
  const syncedKnowledge = getSyncedKnowledge();
  const effectiveFaqList = syncedKnowledge.faqList || [];

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

  // YamatoApiCommon に流し込む（portalDataを排除し、同期されたfaqListを使用）
  return await YamatoApiCommon(QUESTIONS_SPECIFIC_CONTEXT, {
    ...baseOptions,
    faqList: effectiveFaqList,
    timeZone: options.timeZone,
    cityName: options.cityName,
  });
}

export default buildOralExamQuestionsPrompt;