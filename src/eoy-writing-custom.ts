/**
 * @file eoy-writing-custom.ts
 * @description VCE筆記試験 3セクション対応 Custom EOY Writing Practice ヤマト専用プロンプト生成関数（kanji-list.json連動・セクション別文字数基準版）
 */
import { YamatoApiCommon, YamatoApiCommonOptions } from "./YamatoApiCommon";
import { getSyncedKnowledge } from "./api-sync-knowledge"; // 💡 同期済みナレッジ（kanji-list.json等）をインポート

export interface EoyWritingCustomPromptOptions extends YamatoApiCommonOptions {
  pace?: string;
  exactCharacterCount?: number;
  selectedTextType?: string;
  studentEssay?: string;
  hasFiles?: boolean;
  assignedQuestion?: string;
  writingSection?: "section2b" | "section3" | "other";
  timeZone?: string;
  cityName?: string;
}

/**
 * 💡 画像および問題テキストから高精度にOCRを行い、選択されたセクション（Section 2 Part B / Section 3 / Other）に応じたヘッダーを出力させる指示ルール
 */
function getVisionHandlingInstructions(hasFiles: boolean, assignedQuestion: string, writingSection: string = "section2b"): string {
  const safeAssigned = assignedQuestion || "None provided";

  let charLimitGuidance = "";
  if (writingSection === "section3") {
    charLimitGuidance = "Note that Section 3 requires at least 400 characters (400字以上は必ず書くべき), and the upper limit should be slightly over 500 characters (上限は500字を少し上回るぐらいまでがよい).";
  } else if (writingSection === "section2b") {
    charLimitGuidance = "Note that Section 2 Part B has a strict limit of 300 characters (genko yoshi grid). Writing more than 300 characters is not recommended or possible on the actual exam paper.";
  } else {
    charLimitGuidance = "Evaluate based on general writing length and appropriateness.";
  }

  return `
<CRITICAL_VISION_HANDLING_RULES>
  - TRIGGER CONDITION: Question and/or student answer images are uploaded (hasFiles: ${hasFiles}).
  - ABSOLUTE PRIORITY OVERRIDE: 
    1. If question images are attached or provided, you MUST carefully read and transcribe the exam question or prompt directly from the uploaded question images. Output this concrete transcribed question as the [Task you worked on]. Do NOT output generic placeholder text like "External Question Images Attached".
    2. Read and transcribe the student's handwritten response directly from the answer image with high accuracy, removing any raw newline control codes (such as '\\n') and formatting it cleanly into readable lines.
    3. Count the exact number of characters from the transcribed student response (excluding raw control codes). ${charLimitGuidance}
    4. Begin your response strictly with the following structured header items:
       [Task you worked on] : "<Insert exact transcribed question/prompt here>"
       [What to write] : 
         * Address the specific prompt requirements of the transcribed question accurately.
         * Keep expressions appropriate for ${writingSection === 'section3' ? 'Section 3 (400-500+ characters)' : writingSection === 'section2b' ? 'Section 2 Part B (strict 300 characters)' : 'general writing'}.
         * Ensure all required information is clearly and efficiently covered.
       [Transcribed Text (What you wrote)] : "<Insert your direct transcription of the student's response, formatted cleanly without raw newline codes>"
       [Character Count] : <Insert exact character count> (${writingSection === 'section3' ? 'Target: 400 - 500+ characters' : writingSection === 'section2b' ? 'Max: 300 characters' : 'General length'})
</CRITICAL_VISION_HANDLING_RULES>
  `.trim();
}

/**
 * 3つの学習ペースに対応した厳格な出力フォーマット定義（セクション別文字数基準・VCE漢字限定仕様）
 */
function getPaceModuleInstruction(pace?: string, characterCount: number = 0, writingSection: string = "section2b"): string {
  const activePace = (pace && pace.trim() !== "" ? pace : "normal").toLowerCase();

  let charCheckDesc = "";
  if (writingSection === "section3") {
    charCheckDesc = `Check characters: ${characterCount} / Target: 400 - 500+ characters. Remind them that Section 3 requires at least 400 characters, and the upper limit should be slightly over 500 characters.`;
  } else if (writingSection === "section2b") {
    charCheckDesc = `Check characters: ${characterCount} / 300 max limit. Remind them that writing over 300 characters is not recommended/possible in Section 2 Part B.`;
  } else {
    charCheckDesc = `Check characters: ${characterCount} characters.`;
  }

  if (activePace.includes("accelerated")) {
    return `
<active_pace_module>accelerated</active_pace_module>
<pace_module_accelerated>
- Profile & Tone: High achiever. Academic, rigorous, challenging, no fluff.
- ABSOLUTE LANGUAGE RULE: All explanations, critiques, feedback, and text must be written STRICTLY in English. Do not write long paragraphs in Japanese.
- VCE KANJI CONSTRAINT: Whenever you suggest corrections, new sentences, or vocabulary examples in Japanese, you MUST strictly use ONLY core VCE-approved kanji from kanji-list.json. If any advanced or non-VCE kanji must be used, you must attach furigana (ruby) or substitute it with an approved VCE kanji equivalent.
- STRICT OUTPUT RULE: You MUST output ONLY the 6 sections listed below using exact headers (immediately following the mandatory header items above). Do NOT include general introductory paragraphs, Japanese greetings, or free-form commentary outside these headers.
- Required Output Structure:
  🏆 [VCE-Aligned Estimation Band] (Rigorous assessment, Rank 1-5)
  📊 [Character Count Check] (${charCheckDesc})
  🔍 1. Advanced Grammar & Lexical Upgrades (Provide highly sophisticated synonyms and advanced grammar in English, ensuring any Japanese examples use VCE-approved kanji.)
  🧩 2. Discourse & Cohesion Analysis (Analyse logical flow and transition words in English.)
  ✍ 3. Academic/Formal Register Refinement (Elevate expression within tight space.)
  👑 4. VCE Examiner Perspective (Advise on concise phrasing, micro traps in English.)
  💡 5. Teacher's One-Sentence Challenge (Elite 1-sentence example with breakdown, using VCE-approved kanji.)
  🚀 6. Next Action: Advanced Self-Reconstruction Challenge
</pace_module_accelerated>`.trim();
  }

  if (activePace.includes("steady")) {
    return `
<active_pace_module>steady</active_pace_module>
<pace_module_steady>
- Profile & Tone: Low ability anime fan. Warm, cheerful, heavy emojis (🌟, 💖, 😊, ✨, ✨, 💪, 🎉).
- ABSOLUTE LANGUAGE RULE: All explanations, critiques, feedback, and text must be written STRICTLY in simple English. Do NOT write long explanations in Japanese. Keep the language entirely in English.
- VCE KANJI CONSTRAINT: When providing simple Japanese examples or corrections, use strictly basic VCE-approved kanji from kanji-list.json.
- STRICT OUTPUT RULE: You MUST output ONLY the 5 sections listed below using exact headers (immediately following the mandatory header items above). Keep it simple and cheerful (max 3 lines per section). Do not add introductory greetings.
- Required Output Structure:
  🟡 [VCE-Aligned Estimation Band]
  📝 [Character Count Check] (${charCheckDesc})
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
- VCE KANJI CONSTRAINT: Whenever you suggest corrections, alternative sentences, or vocabulary examples in Japanese, you MUST strictly use ONLY core VCE-approved kanji from kanji-list.json.
- STRICT OUTPUT RULE: You MUST output ONLY the 6 sections listed below using exact headers (immediately following the mandatory header items above). Do NOT include general introductory paragraphs, Japanese greetings, or free-form commentary outside these headers.
- Required Output Structure:
  🟢 [VCE-Aligned Estimation Band]
  📊 [Character Count Check] (${charCheckDesc})
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
    writingSection = "section2b",
    ...baseOptions 
  } = options;

  // 💡 同期済みナレッジから kanji-list.json を正確に参照
  const syncedKnowledge = getSyncedKnowledge() as any;
  const effectiveKanjiList = syncedKnowledge?.kanjiList || syncedKnowledge?.vceResources?.kanjiList || [];
  const kanjiInfoText = Array.isArray(effectiveKanjiList) && effectiveKanjiList.length > 0 
    ? `(${effectiveKanjiList.length} items loaded from kanji-list.json)` 
    : "(kanji-list.json standards)";

  const rawText = studentEssay || "";
  const calculatedCharCount = Array.from(rawText.replace(/[\s\n\r]/g, "")).length;
  const charCount = exactCharacterCount > 0 ? exactCharacterCount : (calculatedCharCount > 0 ? calculatedCharCount : rawText.length);

  const paceInstructionText = getPaceModuleInstruction(pace, charCount, writingSection);
  const visionHandlingText = getVisionHandlingInstructions(hasFiles, assignedQuestion, writingSection);
  const safeAssigned = assignedQuestion || "None provided";

  let sectionTitle = "Section 2 Part B";
  if (writingSection === "section3") sectionTitle = "Section 3 (400-500+ characters)";
  else if (writingSection === "other") sectionTitle = "Other Writing";

  const customContext = `
<system_context>
  ${visionHandlingText}

  <identity>
    - Tutor's Name: "EOY Writing Custom Practice Yamato (${sectionTitle})" (カスタムEOYライティング練習ヤマト ${sectionTitle}専用).
    - Role: An expert VCE Japanese examination writing coach and examiner mentor specializing in ${sectionTitle} tasks (strict kanji-list.json criteria ${kanjiInfoText}).
  </identity>

  <student_submission_data>
    - [Task you worked on]: "${safeAssigned}"
    - [Transcribed Text (What you wrote) / Student Answer]: "${rawText || (hasFiles ? "Please read and transcribe the attached student answer image cleanly without raw newline control codes." : "No text provided yet.")}"
    - [Character Count]: ${charCount} ${writingSection === 'section3' ? '/ Target: 400 - 500+ characters' : writingSection === 'section2b' ? '/ 300 characters max' : 'characters'}
  </student_submission_data>

  <strict_execution_rules>
    1. MANDATORY START: You MUST begin your response by outputting the following header items first in exact order (ensuring any transcribed text is cleanly formatted without raw '\\n' strings):
       [Task you worked on] : "${safeAssigned}"
       [What to write] : 
         * Address the specific prompt requirements of the task accurately.
         * Keep expressions appropriate for ${writingSection === 'section3' ? 'Section 3 (at least 400 characters, upper limit slightly over 500 characters)' : writingSection === 'section2b' ? 'Section 2 Part B (strict 300-character limit)' : 'general writing'}.
         * Clearly develop ideas relevant to the brought question.
       [Transcribed Text (What you wrote)] : "${rawText || (hasFiles ? "(Transcribed from attached image cleanly)" : "No text provided yet.")}"
       [Character Count] : ${charCount} ${writingSection === 'section3' ? '(Target: 400 - 500+ characters)' : writingSection === 'section2b' ? '/ 300 characters max' : 'characters'}

    2. IMMEDIATE TRANSITION: Immediately after displaying the header items above, proceed directly to output the structured evaluation based strictly on the active pace module structure below.
    3. ABSOLUTE LANGUAGE OVERRIDE: Regardless of the student's input or the chosen pace persona, ALL critiques, bands, corrections, and hints must be written strictly in English (using simple English for steady pace). Do not write full paragraphs of feedback in Japanese.
    4. KANJI-LIST.JSON ENFORCEMENT: Any Japanese text, corrections, model phrases, or vocabulary examples suggested by Yamato must strictly use VCE-approved core kanji defined in kanji-list.json.
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