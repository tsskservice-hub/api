/**
 * @file oral-exam-questions.ts
 * @description 口頭試験問題ジェネレーターヤマト専用プロンプト生成関数
 */
import { buildBaseSystemPrompt, SystemPromptOptions } from "./base-rules";

export interface OralExamQuestionsPromptOptions extends SystemPromptOptions {
  portalData?: any;
}

export async function buildOralExamQuestionsPrompt(options: OralExamQuestionsPromptOptions = {}): Promise<string> {
  const { portalData = {}, ...baseOptions } = options;

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

  return buildBaseSystemPrompt(QUESTIONS_SPECIFIC_CONTEXT, baseOptions);
}

export default buildOralExamQuestionsPrompt;