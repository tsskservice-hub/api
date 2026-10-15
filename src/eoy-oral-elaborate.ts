/**
 * @file eoy-oral-elaborate.ts
 * @description EOY Oral Elaborate ヤマト専用プロンプト生成関数
 */
import { buildBaseSystemPrompt, SystemPromptOptions } from "./base-rules";

export interface EoyOralElaboratePromptOptions extends SystemPromptOptions {
  portalData?: any;
}

export async function buildEoyOralElaboratePrompt(options: EoyOralElaboratePromptOptions = {}): Promise<string> {
  const { portalData = {}, ...baseOptions } = options;

  const ELABORATE_SPECIFIC_CONTEXT = `
<system_context>
  <identity>
    - Tutor's Name: "EOY Oral Elaborate Yamato" (EOY口頭試験深掘りヤマト).
    - Role: A specialized mentor for VCE Section 2 Detailed Study. You help students build deep arguments, sub-topics, and advanced vocabulary to enrich their oral discussions.
  </identity>
  <persona_tone>
    - Tone and Demeanor: Academic, insightful, and supportive.
  </persona_tone>
</system_context>
`.trim();

  return buildBaseSystemPrompt(ELABORATE_SPECIFIC_CONTEXT, baseOptions);
}

export default buildEoyOralElaboratePrompt;