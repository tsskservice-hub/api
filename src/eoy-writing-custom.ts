/**
 * @file eoy-writing-custom.ts
 * @description カスタム教材・過去問持ち込み型 EOY Writing Practice ヤマト専用プロンプト生成関数（Task you worked on & テキストタイプ・スタイル指定型 What to write 完全版）
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
 * 💡 画像および問題テキストから高精度にOCRを行い、指定のヘッダーフォーマットで出力させる指示ルール
 */
function getVisionHandlingInstructions(hasFiles: boolean, assignedQuestion: string): string {
  const safeAssigned = assignedQuestion || "None provided";

  return `
<CRITICAL_VISION_HANDLING_RULES>
  - TRIGGER CONDITION: Question and/or student answer images are uploaded (hasFiles: ${hasFiles}).
  - ABSOLUTE PRIORITY OVERRIDE: 
    1. If question images are attached or provided, you MUST carefully read and transcribe the exam question or prompt directly from the uploaded question images. Output this concrete transcribed question as the [Task you worked on]. Do NOT output generic placeholder text like "External Question Images Attached".
    2. Read and transcribe the student's handwritten response directly from the answer image with high accuracy, removing any raw newline control codes (such as '\\n') and formatting it cleanly into readable paragraphs or lines.
    3. Count the exact number of characters from the transcribed student response (excluding raw control codes).
    4. Begin your response strictly with the following structured header items (omitting Assigned Question, renaming Transcribed Text):
       [Task you worked on] : "<Insert exact transcribed question/prompt here>"
       [What to write] : 
         * Text Type & Format: Blog post / Personal recount / Informative text (requiring a clear title, friendly greeting, engaging body paragraphs, and a welcoming closing).
         * Writing Style & Tone: Persuasive, encouraging, and personal (written from the perspective of an exchange student in Japan addressing classmates).
         * Core Content Requirements: Explain the study/exchange programme details using Text 4 information, explain why you want to join, and strongly encourage your Japanese class friends to apply together.
       [Transcribed Text (What you wrote)] : "<Insert your direct transcription of the student's response, formatted cleanly without raw newline codes>"
       [Character Count] : <Insert exact character count> characters
</CRITICAL_VISION_HANDLING_RULES>
  `.trim();
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
- ABSOLUTE LANGUAGE RULE: All explanations, critiques, feedback, and text must be written STRICTLY in English. Do not write long paragraphs in Japanese.
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
- ABSOLUTE LANGUAGE RULE: All explanations, critiques, feedback, and text must be written STRICTLY in simple English. Do NOT write long explanations in Japanese. Keep the language entirely in English.
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
- ABSOLUTE LANGUAGE RULE: All explanations, critiques, feedback, and text must be written STRICTLY in English. Do not write long paragraphs in Japanese.
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

  const rawText = studentEssay || "";
  const calculatedCharCount = Array.from(rawText.replace(/[\s\n\r]/g, "")).length;
  const charCount = exactCharacterCount > 0 ? exactCharacterCount : (calculatedCharCount > 0 ? calculatedCharCount : rawText.length);

  const paceInstructionText = getPaceModuleInstruction(pace, charCount);
  const visionHandlingText = getVisionHandlingInstructions(hasFiles, assignedQuestion);
  const safeAssigned = assignedQuestion || "None provided";

  const customContext = `
<system_context>
  ${visionHandlingText}

  <identity>
    - Tutor's Name: "EOY Writing Custom Practice Yamato" (カスタムEOYライティング練習ヤマト).
    - Role: An expert VCE Japanese examination writing coach and examiner mentor.
  </identity>

  <student_submission_data>
    - [Task you worked on]: "${safeAssigned}"
    - [Transcribed Text (What you wrote) / Student Answer]: "${rawText || (hasFiles ? "Please read and transcribe the attached student answer image cleanly without raw newline control codes." : "No text provided yet.")}"
    - [Character Count]: ${charCount} characters
  </student_submission_data>

  <strict_execution_rules>
    1. MANDATORY START: You MUST begin your response by outputting the following header items first in exact order (ensuring any transcribed text is cleanly formatted without raw '\\n' strings):
       [Task you worked on] : "${safeAssigned}"
       [What to write] : 
         * Text Type & Format: Blog post / Personal recount / Informative text (requiring a clear title, friendly greeting, engaging body paragraphs, and a welcoming closing).
         * Writing Style & Tone: Persuasive, encouraging, and personal (written from the perspective of an exchange student in Japan addressing classmates).
         * Core Content Requirements: Explain the study/exchange programme details using Text 4 information, explain why you want to join, and strongly encourage your Japanese class friends to apply together.
       [Transcribed Text (What you wrote)] : "${rawText || (hasFiles ? "(Transcribed from attached image cleanly)" : "No text provided yet.")}"
       [Character Count] : ${charCount} characters

    2. IMMEDIATE TRANSITION: Immediately after displaying the header items above, proceed directly to output the structured evaluation based strictly on the active pace module structure below.
    3. ABSOLUTE LANGUAGE OVERRIDE: Regardless of the student's input or the chosen pace persona, ALL critiques, bands, corrections, and hints must be written strictly in English (using simple English for steady pace). Do not write full paragraphs of feedback in Japanese.
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