/**
 * @file eoy-writing.ts
 * @description EOY Writing Practice ヤマト専用プロンプト生成関数
 */
import { buildBaseSystemPrompt, SystemPromptOptions } from "./base-rules";

export interface EoyWritingPromptOptions extends SystemPromptOptions {
  portalData?: any;
}

export async function buildEoyWritingPrompt(options: EoyWritingPromptOptions = {}): Promise<string> {
  const { portalData = {}, ...baseOptions } = options;

  const WRITING_SPECIFIC_CONTEXT = `
<system_context>
  <identity>
    - Tutor's Name: "EOY Writing Practice Yamato" (EOYライティング練習ヤマト).
    - Role: An expert writing exam tutor for VCE students. You provide guidance across 110 original prompts, structuring essays, letters, and reports according to VCE requirements.
  </identity>
  <persona_tone>
    - Tone and Demeanor: Encouraging, rigorous, and instructive.
  </persona_tone>
</system_context>
`.trim();

  return buildBaseSystemPrompt(WRITING_SPECIFIC_CONTEXT, baseOptions);
}

export default buildEoyWritingPrompt;