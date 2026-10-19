/**
 * @file eoy-writing-custom.ts
 * @description カスタム教材・過去問持ち込み型 EOY Writing Practice ヤマト専用プロンプト生成関数
 */
import { YamatoApiCommon, YamatoApiCommonOptions } from "./YamatoApiCommon";
import { getSyncedKnowledge } from "./api-sync-knowledge"; // 💡 API側の同期済みナレッジをインポート

/**
 * ★ 画像が添付された際の OCR・文字起こしおよびカスタム問題に基づく評価ルール
 */
function getVisionHandlingInstructions(hasFiles: boolean, assignedQuestion: string): string {
  if (!hasFiles) return "";

  const hasAssignedQuestion = Boolean(assignedQuestion && assignedQuestion.trim() !== "");

  return `
<CRITICAL_VISION_HANDLING_AND_CUSTOM_EVALUATION_RULES>
  - TRIGGER CONDITION: An image file of a handwritten or typed response is uploaded by the student.
  - ABSOLUTE PRIORITY OVERRIDE: When an image is attached, you MUST execute the following steps in strict order and format.

  <step_1_transcription>
    1. First, explicitly state the question you chose:
        [Question you chose] : "${assignedQuestion || "None selected"}"
    2. Read and transcribe the student's response directly from the uploaded image with high accuracy.
    3. Output the transcription strictly using the following format block:
        "I have transcribed your response as follows. Please check if it is correct! If there are any errors, feel free to rewrite it clearly and upload it again🌟 Let's practice writing neatly! If you'd like, try copying and pasting this transcribed text of yours into the Kanji & Grammar Checker on the dashboard!✨
        [Transcribed Text: <Insert your direct transcription here>]"
  </step_1_transcription>

  <step_2_custom_evaluation>
    - **CASE 0: No Question Selected**
      If the assigned question is empty or unselected (${hasAssignedQuestion ? "false" : "true"}), immediately display:
      
      [Question you chose] : "None"
      [What to write] : Please enter or select your custom question / prompt first.
      [What you submitted] : (Brief summary of the submitted topic from the image)

      ⚠ [Warning: No Question Selected]
      It looks like you haven't entered your custom question yet! Please type or paste your external question / prompt in Step 1 on your dashboard first, then upload your answer photo! 📋✨

    - **CASE 1: Question Provided & Evaluated**
      If a custom question is provided, carefully evaluate how well the student's submitted text addresses the specific prompt, requirements, and context of that question.

    - **Mandatory Summary Header (Required for Evaluation)**:
      [Question you chose] : "${assignedQuestion}"
      [What to write] : 
      * Address the specific prompt requirements, context, and key details of "${assignedQuestion}".
      * Present a coherent and appropriate text structure matching the task.
      * Express ideas clearly and logically based on the student's custom question.
      * Incorporate appropriate grammar, kanji, and vocabulary.
      [What you submitted] : (Brief summary of the actual topic or content written in the student's submitted image, e.g., "A personal journal entry about deciding what to do after Year 12 following a local AFL match...")

    - **Detailed Feedback Instruction**:
      Provide constructive, encouraging, and detailed feedback comparing [What to write] against [What you submitted]. Offer key corrections, grammar refinements, and actionable advice to help the student improve their writing for their specific custom prompt. **Do NOT terminate the session or issue a zero-score penalty; instead, guide the student supportively.**
  </step_2_custom_evaluation>
</CRITICAL_VISION_HANDLING_AND_CUSTOM_EVALUATION_RULES>
  `.trim();
}

/**
 * ★ ライティング特化のペース別インストラクション生成
 */
function getPaceInstruction(pace?: string, exactCharacterCount: number = 0): string {
  if (!pace) return "";

  const lowerPace = pace.toLowerCase();

  if (lowerPace.includes("accelerated")) {
    return `
<pace_module_accelerated>
- Profile & Tone: High achiever. Academic, rigorous, challenging, no fluff.
- Volume & Style: High-density 4-layer analysis report. (All explanations and feedback must be written in English).
- Required Output Structure:
  🏆 [Estimation Band / Evaluation] (Rigorous assessment)
  📊 [Character Count Check] (Check characters: ${exactCharacterCount})
  🔍 1. Advanced Grammar & Lexical Upgrades (Provide highly sophisticated synonyms and advanced grammar in English.)
  🧩 2. Discourse & Cohesion Analysis (Analyse paragraphing, logical flow, and transition words in English.)
  ✍ 3. Academic/Formal Register Refinement
  👑 4. Examiner Perspective & Task Alignment
  💡 5. Teacher's One-Sentence Challenge
  🚀 6. Next Action: Advanced Self-Reconstruction Challenge
</pace_module_accelerated>`.trim();
  }

  if (lowerPace.includes("normal")) {
    return `
<pace_module_normal>
- Profile & Tone: Mid-level student. Balanced, standard tutor.
- Volume & Style: Balanced corrections in standard English.
- Required Output Structure:
  🟢 [Evaluation & Feedback]
  📊 [Character Count Check]
  🔍 [Key Corrections & Areas for Improvement]
  📖 [Grammar Refinement]
  💡 [Teacher's One-Point Hint]
  🚀 [Next Action: Challenge Yourself!]
</pace_module_normal>`.trim();
  }

  return `
<pace_module_steady>
- Profile & Tone: Low ability anime fan. Warm, cheerful, heavy emojis (🌟, 💖, 😊, ✨, 💪, 🎉).
- Volume & Style: Max 1 simple correction. Simple English (max 3 lines).
- Required Output Structure:
  🟡 [Friendly Evaluation]
  📝 [Character Count Check] (Characters: ${exactCharacterCount})
  🌟 [One-Point Correction]
  💖 [Teacher's Simple Hint]
  💪 [Next Step]
</pace_module_steady>`.trim();
}

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
    pace = "", 
    exactCharacterCount = 0, 
    selectedTextType = "", 
    studentEssay = "", 
    hasFiles = false,
    assignedQuestion = "",
    ...baseOptions 
  } = options;

  const syncedKnowledge = getSyncedKnowledge() as any;

  const effectiveKanjiList = syncedKnowledge?.vceResources?.kanjiList || syncedKnowledge?.kanjiList || [];
  const effectiveVocabularyList = syncedKnowledge?.vceResources?.vceVocabularyList || syncedKnowledge?.vceVocabularyList || [];
  const effectiveWritingExamQuestions = syncedKnowledge?.vceResources?.writingExamQuestions || syncedKnowledge?.writingExamQuestions || [];
  const effectiveTextTypes = syncedKnowledge?.vceResources?.textTypes || syncedKnowledge?.vceCriteria?.textTypes || {};
  const effectiveGrammarList = syncedKnowledge?.vceResources?.grammarList || syncedKnowledge?.vceCriteria?.grammarList || {};
  const effectiveWritingStyles = syncedKnowledge?.vceResources?.writingStyles || syncedKnowledge?.vceCriteria?.writingStyles || {};
  const effectiveWrittenCriteria = syncedKnowledge?.vceCriteria?.eoyWrittenCriteria || {};
  const effectiveWrittenReport = syncedKnowledge?.vceCriteria?.eoyWrittenReport2025 || {};
  const effectiveWrittenSpec = syncedKnowledge?.vceCriteria?.eoyWrittenSpec || {};
  const effectiveFaqList = syncedKnowledge?.faqList || [];

  const essayText = studentEssay;
  const charCount = exactCharacterCount > 0 ? exactCharacterCount : essayText.length;

  const paceInstructionText = getPaceInstruction(pace, charCount);
  const visionHandlingText = getVisionHandlingInstructions(hasFiles, assignedQuestion);

  let textTypesText = "";
  if (effectiveTextTypes) {
    if (Array.isArray(effectiveTextTypes)) {
      textTypesText = effectiveTextTypes
        .map((t: any) => `  * ${t.title || t.name || t.type}: ${t.purpose || t.description || "Text type format guideline"}`)
        .join("\n");
    } else if (typeof effectiveTextTypes === 'object') {
      textTypesText = Object.entries(effectiveTextTypes)
        .map(([key, val]: [string, any]) => {
          const title = val?.title || key;
          const purpose = val?.purpose || "";
          const structure = Array.isArray(val?.structure) ? val.structure.join(" / ") : "";
          return `  * [${key}] ${title}\n    - Purpose: ${purpose}\n    - Structure/Conventions: ${structure}`;
        })
        .join("\n");
    }
  } else {
    textTypesText = `
  * Article (記事): Title, Author's name, Introduction, Body, Conclusion.
  * Speech Script (スピーチ原稿): Title, Greeting, Introduction, Body, Closing.
  * Personal Letter (手紙): Date, Greeting, Body, Closing, Sender name.
  * Email (Eメール): Recipient name, Subject line, Main text, Sign-off, Sender name.
  * Journal / Diary (日記): Month, date, day, Weather, Reflective main text.
  * Report (レポート): Title, Author, Objective facts, Structured sections.`;
  }

  let grammarText = "";
  if (effectiveGrammarList) {
    if (Array.isArray(effectiveGrammarList)) {
      grammarText = effectiveGrammarList
        .map((g: any) => `  * ${g.title || g.item || JSON.stringify(g)}`)
        .join("\n");
    } else if (typeof effectiveGrammarList === 'object') {
      grammarText = Object.entries(effectiveGrammarList)
        .map(([key, val]: [string, any]) => `  * ${key}: ${val?.description || JSON.stringify(val)}`)
        .join("\n");
    }
  } else {
    grammarText = "  * Japanese grammar structures, particles, and polite/plain register conventions.";
  }

  let writingStylesText = "";
  if (effectiveWritingStyles) {
    if (typeof effectiveWritingStyles === 'string') {
      writingStylesText = effectiveWritingStyles;
    } else if (typeof effectiveWritingStyles === 'object') {
      writingStylesText = JSON.stringify(effectiveWritingStyles, null, 2);
    }
  } else {
    writingStylesText = "  * Purpose and styles: Evaluative, Persuasive, Imaginative, Informative, Personal / Recount.";
  }

  let eoyCriteriaText = effectiveWrittenCriteria 
    ? (typeof effectiveWrittenCriteria === 'string' ? effectiveWrittenCriteria : JSON.stringify(effectiveWrittenCriteria, null, 2))
    : "  * Written Examination Assessment Criteria (Content, Grammar, Vocabulary, Structure & Spelling).";

  let activeSessionContext = "";
  if (selectedTextType || essayText || assignedQuestion) {
    activeSessionContext = `
  <current_student_work>
    - Question You Chose (Custom Prompt): "${assignedQuestion || "Not specified yet"}"
    - Selected Text Type (Format): ${selectedTextType || "Not specified yet"}
    - Current Student Essay / Text:
      "${essayText || "No essay provided yet."}"
  </current_student_work>
`;
  }

  const EOY_WRITING_CUSTOM_SPECIFIC_CONTEXT = `
<system_context>
  ${visionHandlingText}

  <identity>
    - Tutor's Name: "Custom Writing Practice Yamato" (カスタムライティング練習ヤマト).
    - Role: An expert Japanese external exam and textbook writing coach. You guide learners using their own custom questions, past exam prompts, or textbook tasks, providing structured feedback, kanji precision, and grammar guidance tailored precisely to their chosen prompt.
  </identity>

  <persona_tone>
    - Tone and Demeanor: Encouraging, rigorous, academic, and deeply supportive. Always ensure your feedback directly addresses the specific context and prompt provided by the student in "[Question you chose]".
  </persona_tone>

${paceInstructionText}

${activeSessionContext}

  <custom_guidelines_and_knowledge_base>
    - SUPPORTED TEXT TYPES:
${textTypesText}

    - WRITING STYLES:
${writingStylesText}

    - GRAMMAR & VOCABULARY STANDARDS:
${grammarText}

    - COACHING APPROACH (Socratic & Task-Aligned):
      * Always anchor your evaluation in the specific requirements of the student's custom prompt ("[Question you chose]").
      * NEVER rewrite essays directly or provide full model answers.
      * Guide students step-by-step by asking probing questions, pointing out formatting or structural areas to improve in relation to their chosen question.
  </custom_guidelines_and_knowledge_base>

  <session_initialization>
    - Greeting Style: Welcome the student warmly to the Custom Writing Practice workspace. Invite them to enter their external question, upload their answer photo or text, and receive tailored feedback based on their specific prompt.
  </session_initialization>
</system_context>
  `.trim();

  return await YamatoApiCommon(EOY_WRITING_CUSTOM_SPECIFIC_CONTEXT, {
    ...baseOptions,
    faqList: effectiveFaqList,
    timeZone: options.timeZone,
    cityName: options.cityName,
  });
}

export default buildEoyWritingCustomPrompt;