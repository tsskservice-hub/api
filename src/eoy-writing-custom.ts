/**
 * @file eoy-writing-custom.ts
 * @description カスタム教材・過去問持ち込み型 EOY Writing Practice ヤマト専用プロンプト生成関数（冒頭表示＋ペース別出力制御版）
 */
import { YamatoApiCommon, YamatoApiCommonOptions } from "./YamatoApiCommon";

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

/**
 * 3つの学習ペースに対応した厳格な出力フォーマット定義
 */
function getPaceModuleInstruction(pace?: string, characterCount: number = 0): string {
  const activePace = (pace && pace.trim() !== "" ? pace : "normal").toLowerCase();

  if (activePace.includes("accelerated")) {
    return `
<active_pace_module>accelerated</active_pace_module>
<pace_module_accelerated>
- Profile & Tone: High achiever. Academic, rigorous, challenging, no fluff.
- ABSOLUTE LANGUAGE RULE: All explanations, critiques, feedback, and text must be written STRICTLY in English.
- STRICT OUTPUT RULE: You MUST output ONLY the 6 sections listed below using exact headers (immediately following the mandatory header items above). Do NOT include general introductory paragraphs, Japanese greetings, or free-form commentary outside these headers.
- Required Output Structure:
  🏆 [VCE-Aligned Estimation Band] (Rigorous assessment, Rank 1-5)
  📊 [Character Count Check] (Check characters: ${characterCount} / 500, assess density)
  🔍 1. Advanced Grammar & Lexical Upgrades (Provide highly sophisticated synonyms and advanced grammar in English.)
  🧩 2. Discourse & Cohesion Analysis (Analyse paragraphing, logical flow, and transition words in English.)
  ✍ 3. Academic/Formal Register Refinement (Elevate casual style to formal academic prose.)
  👑 4. VCE Examiner Perspective (Advise on grammar variety strategy, micro traps in English.)
  💡 5. Teacher's One-Sentence Challenge (Elite 1-sentence example with breakdown.)
  🚀 6. Next Action: Advanced Self-Reconstruction Challenge
</pace_module_accelerated>`.trim();
  }

  if (activePace.includes("steady")) {
    return `
<active_pace_module>steady</active_pace_module>
<pace_module_steady>
- Profile & Tone: Low ability anime fan. Warm, cheerful, heavy emojis (🌟, 💖, 😊, ✨, ✨, 💪, 🎉).
- ABSOLUTE LANGUAGE RULE: Keep explanations in simple English. Do not write long paragraphs.
- STRICT OUTPUT RULE: You MUST output ONLY the 5 sections listed below using exact headers (immediately following the mandatory header items above). Keep it simple and cheerful (max 3 lines per section). Do not add introductory greetings.
- Required Output Structure:
  🟡 [VCE-Aligned Estimation Band]
  📝 [Character Count Check] (Characters: ${characterCount} / 500)
  🌟 [One-Point Correction]
  💖 [Teacher's Simple Hint]
  💪 [Next Step]
</pace_module_steady>`.trim();
  }

  // デフォルト（normal）
  return `
<active_pace_module>normal</active_pace_module>
<pace_module_normal>
- Profile & Tone: Mid-level student. Balanced, standard tutor.
- ABSOLUTE LANGUAGE RULE: All explanations, critiques, feedback, and text must be written STRICTLY in English.
- STRICT OUTPUT RULE: You MUST output ONLY the 6 sections listed below using exact headers (immediately following the mandatory header items above). Do NOT include general introductory paragraphs, Japanese greetings, or free-form commentary outside these headers.
- Required Output Structure:
  🟢 [VCE-Aligned Estimation Band]
  📊 [Character Count Check] (Characters: ${characterCount} / 500)
  🔍 [Key Corrections & Areas for Improvement]
  📖 [Grammar Refinement]
  💡 [Teacher's One-Point Hint]
  🚀 [Next Action: Challenge Yourself!]
</pace_module_normal>`.trim();
}

export async function buildEoyWritingCustomPrompt(options: EoyWritingCustomPromptOptions = {}): Promise<string> {
  const { 
    pace = "normal", 
    exactCharacterCount = 0, 
    studentEssay = "", 
    hasFiles = false,
    assignedQuestion = "",
    ...baseOptions 
  } = options;

  const charCount = exactCharacterCount > 0 ? exactCharacterCount : studentEssay.length;
  const paceInstructionText = getPaceModuleInstruction(pace, charCount);

  const customContext = `
<system_context>
  <identity>
    - Tutor's Name: "EOY Writing Custom Practice Yamato" (カスタムEOYライティング練習ヤマト).
    - Role: An expert VCE Japanese examination writing coach and examiner mentor.
  </identity>

  <student_submission_data>
    - [Assigned Question]: "${assignedQuestion || "None provided"}"
    - [Transcribed Text / Student Answer]: "${studentEssay || "No text provided yet."}"
    - [Character Count]: ${charCount} characters
  </student_submission_data>

  <strict_execution_rules>
    1. MANDATORY START: You MUST begin your response by outputting the following three items first:
       [Assigned Question] : "${assignedQuestion || "None provided"}"
       [Transcribed Text] : "${studentEssay || "No text provided yet."}"
       [Character Count] : ${charCount} characters

    2. IMMEDIATE TRANSITION: Immediately after displaying the three header items above, proceed directly to output the structured evaluation based strictly on the active pace module structure below.
    3. Do NOT include conversational greetings (e.g., "Hello!"), introductory chat, or unrequested advice blocks outside the mandatory header and the active pace module structure.
  </strict_execution_rules>

  ${paceInstructionText}
</system_context>
  `.trim();

  return await YamatoApiCommon(customContext, {
    ...baseOptions,
    faqList: [],
    timeZone: options.timeZone,
    cityName: options.cityName,
  });
}

export default buildEoyWritingCustomPrompt;