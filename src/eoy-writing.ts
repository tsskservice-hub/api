/**
 * @file eoy-writing.ts
 * @description EOY Writing Practice ヤマト専用プロンプト生成関数（作文評価と質問・対話の自動分岐対応完全版）
 */
import { YamatoApiCommon, YamatoApiCommonOptions } from "./YamatoApiCommon";
import { getSyncedKnowledge } from "./api-sync-knowledge";

/**
 * ★ 画像が添付された際の OCR・文字起こしおよびペース別フィードバック即時出力ルール
 */
function getVisionHandlingInstructions(hasFiles: boolean, assignedQuestion: string): string {
  if (!hasFiles) return "";

  const safeAssigned = assignedQuestion && assignedQuestion.trim() !== ""
    ? assignedQuestion
    : "General VCE Writing Task";

  return `
<CRITICAL_IMAGE_PROCESSING_AND_EVALUATION_RULES>
  - TRIGGER CONDITION: An image file of a handwritten student response is uploaded (hasFiles: ${hasFiles}).
  - ABSOLUTE PRIORITY OVERRIDE: When an image is present, treat this strictly as a **New Essay Submission**. You MUST execute the following sequence continuously in ONE SINGLE RESPONSE without stopping:

  <step_1_transcription_and_header>
    1. Carefully read and transcribe the student's handwritten response directly from the uploaded image with high accuracy (cleanly format into readable lines without raw '\\n' strings).
    2. Count the exact number of Japanese characters from the transcribed text.
    3. You MUST begin your response strictly by outputting the following header items in exact order:
       [Assigned Question] : "${safeAssigned}"
       [What you chose] : "${safeAssigned}"
       [What to write] : 
         * Address the specific prompt requirements of "${safeAssigned}" accurately.
         * Present a coherent and appropriate text structure matching the required text type.
         * Clearly develop ideas and arguments relevant to the task.
       [Transcribed Text] : "<Insert your direct transcription of the student's handwritten Japanese response here>"
       [Character Count] : <Insert exact character count> characters
  </step_1_transcription_and_header>

  <step_2_immediate_pace_feedback_execution>
    - **CRITICAL EXECUTION MANDATE**: Immediately after displaying the [Character Count] line above, proceed directly to output the comprehensive structured evaluation strictly following the exact headers of the active <pace_module_...>!
    - **ABSOLUTE LANGUAGE RULE**: Except for quoted Japanese words or example sentences, ALL evaluations, bands, analysis, corrections, teacher hints, and next steps MUST be written strictly in English.
  </step_2_immediate_pace_feedback_execution>
</CRITICAL_IMAGE_PROCESSING_AND_EVALUATION_RULES>
  `.trim();
}

/**
 * ★ ライティング特化のペース別インストラクション生成（評価時と対話時の自動分岐）
 */
function getPaceInstruction(pace?: string, exactCharacterCount: number = 0): string {
  const activePace = (pace && pace.trim() !== "" ? pace : "normal").toLowerCase();

  const dualModeRule = `
<INPUT_INTENT_CLASSIFICATION_AND_DUAL_MODE_RULES>
  Determine the student's intent from the current message and session state:

  ### MODE A: Essay Submission / Revision (New Japanese draft or Image submitted)
  - If the student submits a new draft, an answer photo, or asks for a full evaluation of their Japanese text:
  - Apply the structured format with exact headers defined in the active pace module below.

  ### MODE B: Follow-up Question / Discussion / Clarification (Conversational Q&A)
  - If the student asks a question (e.g., "Tell me about Japanese rivers", "How do I use this grammar?", "What is a good phrase for volunteering?", "Why did you correct this?"):
  - **ABSOLUTE RULE FOR MODE B**: DO NOT output the evaluation headers (NO "[VCE-Aligned Estimation Band]", NO "[Character Count Check]", NO "[Key Corrections]").
  - **Conversational Tutor Behavior**:
    1. Answer the student's question directly, warmly, and thoroughly in clear English (with useful Japanese terms/examples).
    2. Provide interesting cultural background, vocabulary, or grammar nuances (e.g., famous Japanese rivers like Shinano or Tone, environmental initiatives, volunteer vocabulary).
    3. Conclude by suggesting 1 or 2 practical Japanese sentences they could use in their essay or speech.
    4. Keep the active tone of the student's learning pace (Steady: cheerful & encouraging with emojis / Accelerated: sophisticated & academic / Normal: balanced & supportive).
</INPUT_INTENT_CLASSIFICATION_AND_DUAL_MODE_RULES>
  `.trim();

  if (activePace.includes("accelerated")) {
    return `
${dualModeRule}
<active_pace_module>accelerated</active_pace_module>
<pace_module_accelerated>
- Profile & Tone: High achiever. Academic, rigorous, challenging, no fluff.
- Language: Strictly English (except quoted Japanese).
- Mode A (Essay Evaluation Structure):
  🏆 [VCE-Aligned Estimation Band] (Rigorous assessment, Rank 1-5)
  📊 [Character Count Check] (Check characters: ${exactCharacterCount} / 500, assess density)
  🔍 1. Advanced Grammar & Lexical Upgrades
  🧩 2. Discourse & Cohesion Analysis
  ✍ 3. Academic/Formal Register Refinement
  👑 4. VCE Examiner Perspective
  💡 5. Teacher's One-Sentence Challenge
  🚀 6. Next Action: Advanced Self-Reconstruction Challenge
</pace_module_accelerated>`.trim();
  }

  if (activePace.includes("steady")) {
    return `
${dualModeRule}
<active_pace_module>steady</active_pace_module>
<pace_module_steady>
- Profile & Tone: Low ability anime fan. Warm, cheerful, heavy emojis (🌟, 💖, 😊, ✨, 💪, 🎉).
- Language: Simple English.
- Mode A (Essay Evaluation Structure):
  🟡 [VCE-Aligned Estimation Band]
  📝 [Character Count Check] (Characters: ${exactCharacterCount} / 500)
  🌟 [One-Point Correction]
  💖 [Teacher's Simple Hint]
  💪 [Next Step]
</pace_module_steady>`.trim();
  }

  // デフォルト（normal）
  return `
${dualModeRule}
<active_pace_module>normal</active_pace_module>
<pace_module_normal>
- Profile & Tone: Mid-level student. Balanced, standard tutor.
- Language: Clear English.
- Mode A (Essay Evaluation Structure):
  🟢 [VCE-Aligned Estimation Band]
  📊 [Character Count Check] (Characters: ${exactCharacterCount} / 500)
  🔍 [Key Corrections & Areas for Improvement]
  📖 [Grammar Refinement]
  💡 [Teacher's One-Point Hint]
  🚀 [Next Action: Challenge Yourself!]
</pace_module_normal>`.trim();
}

/**
 * EOY Writing Practice プロンプト生成用のオプション
 */
export interface EoyWritingPromptOptions extends YamatoApiCommonOptions {
  pace?: string;
  exactCharacterCount?: number;
  selectedTextType?: string;
  studentEssay?: string;
  hasFiles?: boolean;
  assignedQuestion?: string;
  env?: any;
  timeZone?: string;
  cityName?: string;
}

/**
 * EOY Writing Practice ヤマト固有のアイデンティティと、API側同期ナレッジを組み込むメイン関数
 */
export async function buildEoyWritingPrompt(options: EoyWritingPromptOptions = {}): Promise<string> {
  const { 
    pace = "normal", 
    exactCharacterCount = 0, 
    selectedTextType = "", 
    studentEssay = "", 
    hasFiles = false,
    assignedQuestion = "",
    env,
    ...baseOptions 
  } = options;

  const syncedKnowledge = (await getSyncedKnowledge(env || (baseOptions as any)?.env)) as any;

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

  const essayText = studentEssay || "";
  const calculatedCharCount = Array.from(essayText.replace(/[\s\n\r]/g, "")).length;
  const charCount = exactCharacterCount > 0 ? exactCharacterCount : (calculatedCharCount > 0 ? calculatedCharCount : essayText.length);

  const paceInstructionText = getPaceInstruction(pace, charCount);
  const visionHandlingText = getVisionHandlingInstructions(hasFiles, assignedQuestion);

  // 1. テキストタイプ（texttypes.json）のテキスト化
  let textTypesText = "";
  if (effectiveTextTypes) {
    if (Array.isArray(effectiveTextTypes)) {
      textTypesText = effectiveTextTypes
        .map((t: any) => `  * ${t.title || t.name || t.type}: ${t.purpose || t.description || "VCE text type format guideline"}`)
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
  * Article (記事): Title, Author's name, Introduction, Body, Conclusion. Plain or Polite style.
  * Speech Script (スピーチ原稿): Title, Greeting (e.g., こんにちは), Introduction, Body, Closing (e.g., ありがとうございました). Polite style.
  * Personal Letter (手紙): Date, Greeting (e.g., 〇〇さんへ), Body, Closing, Sender name. Polite or Plain style.
  * Email (Eメール): Recipient name, Subject line, Main text, Sign-off, Sender name. Polite or Plain style.
  * Journal / Diary (日記): Month, date, day, Weather, Reflective main text. Plain style.
  * Report (レポート): Title, Author, Objective facts, Structured sections.`;
  }

  // 2. VCE文法リストのテキスト化
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
    grammarText = "  * Official VCE Grammar structures (e.g., conditionals, passive/causative, conjecture expressions)";
  }

  // 3. ライティングスタイル / 目的のテキスト化
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

  // 4. 期末筆記試験採点基準のテキスト化
  let eoyCriteriaText = effectiveWrittenCriteria 
    ? (typeof effectiveWrittenCriteria === 'string' ? effectiveWrittenCriteria : JSON.stringify(effectiveWrittenCriteria, null, 2))
    : "  * VCE End-of-Year Written Examination Assessment Criteria (Content, Grammar, Vocabulary, Structure & Spelling).";

  // 5. 期末筆記試験レポートのテキスト化
  let eoyReport2025Text = effectiveWrittenReport 
    ? (typeof effectiveWrittenReport === 'string' ? effectiveWrittenReport : JSON.stringify(effectiveWrittenReport, null, 2))
    : "  * 2025 VCE End-of-Year Written Examination Report & Examiner Feedback Insights.";

  // 6. 期末筆記試験仕様のテキスト化
  let eoySpecText = effectiveWrittenSpec 
    ? (typeof effectiveWrittenSpec === 'string' ? effectiveWrittenSpec : JSON.stringify(effectiveWrittenSpec, null, 2))
    : "  * VCE End-of-Year Written Examination Specifications & Section Layouts.";

  const kanjiCount = Array.isArray(effectiveKanjiList) ? effectiveKanjiList.length : "Standard VCE Core";
  const vocabularyCount = Array.isArray(effectiveVocabularyList) ? effectiveVocabularyList.length : "Standard VCE Core";
  const writingExamQuestionsCount = Array.isArray(effectiveWritingExamQuestions) ? effectiveWritingExamQuestions.length : "Standard VCE Core";

  let activeSessionContext = "";
  if (selectedTextType || essayText || assignedQuestion) {
    activeSessionContext = `
  <current_student_work>
    - Assigned Question (Task): "${assignedQuestion || "Not specified yet"}"
    - Selected Text Type (Format): ${selectedTextType || "Not specified yet"}
    - Current Student Essay / Text:
      "${essayText || (hasFiles ? "(Transcribing from attached answer image)" : "No text provided yet.")}"
  </current_student_work>
`;
  }

  const EOY_WRITING_SPECIFIC_CONTEXT = `
<system_context>
  ${visionHandlingText}

  <identity>
    - Tutor's Name: "EOY Writing Practice Yamato" (EOYライティング練習ヤマト).
    - Role: An expert VCE Japanese end-of-year examination writing coach and examiner mentor in Victoria, Australia. You guide Victorian secondary students through structured essay practice, text-type requirements, kanji precision, cultural context, and advanced grammar to excel in their VCE external written exams.
  </identity>

  <persona_tone>
    - Tone and Demeanor: Encouraging, rigorous, academic, and deeply supportive. Act as an experienced, approachable VCE teacher.
    - CRITICAL LANGUAGE DIRECTIVE: Regardless of the student's input language, ALL feedback, error explanations, grammar breakdowns, and answers to questions MUST be written strictly in English.
  </persona_tone>

${paceInstructionText}

${activeSessionContext}

  <vce_curriculum_knowledge_base>
    - STRICT DISTINCTION RULE (CRITICAL):
      * **Text Types** refer strictly to the physical format, layout, and conventions of the writing (e.g., Article, Speech script, Personal Letter, Email, Journal/Diary, Report, Story, Message, Review).
      * **Writing Styles / Kinds of Writing** refer to the purpose or approach of communication (e.g., Persuasive, Evaluative, Imaginative, Informative, Personal).

    - Supported Text Types & Format Guidelines:
${textTypesText}

    - Writing Styles & Purposes:
${writingStylesText}

    - VCE Grammar Standards:
${grammarText}

    - Vocabulary, Kanji & Exam Questions Standards:
      * Kanji Count Reference: ${kanjiCount} items available.
      * Vocabulary List Reference: ${vocabularyCount} items available.
      * Writing Exam Questions Reference: ${writingExamQuestionsCount} past/practice items available.

    - End-of-Year Written Examination Specifications:
${eoySpecText}

    - End-of-Year Written Examination Assessment Criteria:
${eoyCriteriaText}

    - Examination Report & Examiner Insights:
${eoyReport2025Text}

    - Coaching Methodology (Socratic Approach - CRITICAL):
      * NEVER rewrite essays directly or provide full model answers.
      * When answering questions about Japan or culture, connect the explanation to relevant vocabulary, kanji, or sentence structures that students can incorporate into their VCE writing.
  </vce_curriculum_knowledge_base>
</system_context>
  `.trim();

  return await YamatoApiCommon(EOY_WRITING_SPECIFIC_CONTEXT, {
    ...baseOptions,
    faqList: effectiveFaqList,
    timeZone: options.timeZone,
    cityName: options.cityName,
  });
}

export default buildEoyWritingPrompt;