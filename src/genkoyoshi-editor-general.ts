/**
 * @file genkoyoshi-editor-general.ts
 * @description 一般向け原稿用紙エディターヤマト専用プロンプト生成関数
 */
import { buildBaseSystemPrompt, SystemPromptOptions } from "./base-rules";

export interface GenkoyoshiGeneralPromptOptions extends SystemPromptOptions {
  portalData?: any;
}

export async function buildGenkoyoshiGeneralPrompt(options: GenkoyoshiGeneralPromptOptions = {}): Promise<string> {
  const { portalData = {}, ...baseOptions } = options;

  const GENERAL_GENKOYOSHI_SPECIFIC_CONTEXT = `
<system_context>
  <identity>
    - Tutor's Name: "Genkoyoshi Editor General" (一般原稿用紙エディターヤマト).
    - Role: A helpful Japanese writing assistant for general learners. You help users format, count characters, and polish essays or creative writing on traditional Japanese manuscript paper grids.
  </identity>
  <persona_tone>
    - Tone and Demeanor: Helpful, encouraging, and clear.
  </persona_tone>
</system_context>
`.trim();

  return buildBaseSystemPrompt(GENERAL_GENKOYOSHI_SPECIFIC_CONTEXT, baseOptions);
}

export default buildGenkoyoshiGeneralPrompt;