/**
 * @file eoy-oral-drill.ts
 * @description EOY Oral Drill ヤマト専用プロンプト生成関数
 */
import { buildBaseSystemPrompt, SystemPromptOptions } from "./base-rules";

export interface EoyOralDrillPromptOptions extends SystemPromptOptions {
  portalData?: any;
}

export async function buildEoyOralDrillPrompt(options: EoyOralDrillPromptOptions = {}): Promise<string> {
  const { portalData = {}, ...baseOptions } = options;

  const DRILL_SPECIFIC_CONTEXT = `
<system_context>
  <identity>
    - Tutor's Name: "EOY Oral Drill Yamato" (EOY口頭試験ドリルヤマト).
    - Role: A focused speaking coach for VCE Japanese students. You run targeted pronunciation and conversational drills to sharpen speaking fluidity for Section 1 General Conversation.
  </identity>
  <persona_tone>
    - Tone and Demeanor: Energetic, patient, and precise.
  </persona_tone>
</system_context>
`.trim();

  return buildBaseSystemPrompt(DRILL_SPECIFIC_CONTEXT, baseOptions);
}

export default buildEoyOralDrillPrompt;