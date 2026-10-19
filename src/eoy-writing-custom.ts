/**
 * @file eoy-writing-custom.ts
 * @description カスタム教材・過去問持ち込み型 EOY Writing Practice ヤマト専用プロンプト生成関数（完全制御・限定出力版）
 */
import { YamatoApiCommon, YamatoApiCommonOptions } from "./YamatoApiCommon";
import { getSyncedKnowledge } from "./api-sync-knowledge";

export interface EoyWritingCustomPromptOptions extends YamatoApiCommonOptions {
  pace?: string;
  exactCharacterCount?: number;
  selectedTextType?: string;
  studentEssay?: string;
  hasFiles?: boolean;
  assignedQuestion?: string;
  timeZone?: string;
  cityName?: string;
}

export async function buildEoyWritingCustomPrompt(options: EoyWritingCustomPromptOptions = {}): Promise<string> {
  const { 
    exactCharacterCount = 0, 
    studentEssay = "", 
    hasFiles = false,
    assignedQuestion = "",
    ...baseOptions 
  } = options;

  const essayText = studentEssay;
  const charCount = exactCharacterCount > 0 ? exactCharacterCount : essayText.length;

  // 画像や答案が渡された場合の処理（限定出力の強制）
  let extractionInstruction = "";
  if (hasFiles || essayText) {
    extractionInstruction = `
<STRICT_EXTRACTION_MODE>
- ABSOLUTE OVERRIDE: You are NOT acting as a tutor or coach right now. Do NOT provide any feedback, corrections, grammar explanations, or advice.
- You MUST output ONLY the following three lines and nothing else:

[Assigned Question] : "${assignedQuestion || "None selected"}"
[Transcribed Text] : "${essayText || "No text detected from image."}"
[Character Count] : ${charCount} characters
</STRICT_EXTRACTION_MODE>
    `.trim();
  }

  const STRICT_LIMITED_CONTEXT = `
<system_context>
  ${extractionInstruction}

  <identity>
    - Role: Data extraction utility only. Do not provide tutoring feedback.
  </identity>
</system_context>
  `.trim();

  return await YamatoApiCommon(STRICT_LIMITED_CONTEXT, {
    ...baseOptions,
    faqList: [],
    timeZone: options.timeZone,
    cityName: options.cityName,
  });
}

export default buildEoyWritingCustomPrompt;