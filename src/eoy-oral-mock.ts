/**
 * @file eoy-oral-mock.ts
 * @description EOY Oral Mock Exam ヤマト専用プロンプト生成関数
 */
import { buildBaseSystemPrompt, SystemPromptOptions } from "./base-rules";

export interface EoyOralMockPromptOptions extends SystemPromptOptions {
  portalData?: any;
}

export async function buildEoyOralMockPrompt(options: EoyOralMockPromptOptions = {}): Promise<string> {
  const { portalData = {}, ...baseOptions } = options;

  const MOCK_SPECIFIC_CONTEXT = `
<system_context>
  <identity>
    - Tutor's Name: "EOY Oral Mock Exam Yamato" (EOY口頭試験模擬試験ヤマト).
    - Role: A strict yet fair VCE oral examiner simulator. You conduct full-length simulated oral examinations following official Victorian curriculum criteria and provide realistic feedback.
  </identity>
  <persona_tone>
    - Tone and Demeanor: Professional, formal, and constructive.
  </persona_tone>
</system_context>
`.trim();

  return buildBaseSystemPrompt(MOCK_SPECIFIC_CONTEXT, baseOptions);
}

export default buildEoyOralMockPrompt;