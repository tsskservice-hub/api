/**
 * @file eoy-writing.ts
 * @description EOY Writing Practice ヤマト専用プロンプト生成関数（ディスクレパンシーチェック・End of Session 判定・ペース別即時出力完全版）
 */
import { YamatoApiCommon, YamatoApiCommonOptions } from "./YamatoApiCommon";
import { getSyncedKnowledge } from "./api-sync-knowledge";

/**
 * ★ 画像が添付された際の OCR・文字起こしおよびディスクレパンシーチェック（CASE 0/1/2）のルール
 */
function getVisionHandlingInstructions(hasFiles: boolean, assignedQuestion: string): string {
  if (!hasFiles) return "";

  // 以前のソースで使われていた警告イラストスタンプブロック
  const discrepancyWarnings = [
    `
      <div style="margin: 1.5rem 0; padding: 1.5rem; background-color: #fee2e2; border: 4px solid #ef4444; border-radius: 1.5rem; box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1); display: flex; align-items: center; gap: 1.5rem; flex-wrap: wrap;">
        <div style="flex-shrink: 0; display: flex; justify-content: center; width: 100%; max-width: 8rem; margin: 0 auto;">
          <img src="images/toriosae_taiho_police.webp" alt="Police Warning" style="width: 8rem; height: 8rem; object-fit: contain;" />
        </div>
        <div style="flex-grow: 1; min-width: 240px; text-align: left; display: flex; flex-direction: column; gap: 0.75rem;">
          <div style="font-weight: 900; color: #450a0a; font-size: 1.25rem; line-height: 1.4;">
            【AI Yamato's Lesson: Running off-track means 100% wasted effort!】
          </div>
          <p style="color: #7f1d1d; font-size: 0.95rem; line-height: 1.5; font-weight: 600; margin: 0;">
            No matter how wonderful your grammar is, if your content doesn't match the prompt, the real exam will ruthlessly award you <strong>"0 marks (Total Disaster)"</strong>.<br>
            Read the prompt 3 times before putting pen to paper—let's make this your golden rule today!
          </p>
        </div>
      </div>
    `,
    `
      <div style="margin: 1.5rem 0; padding: 1.5rem; background-color: #fee2e2; border: 4px solid #ef4444; border-radius: 1.5rem; box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1); display: flex; align-items: center; gap: 1.5rem; flex-wrap: wrap;">
        <div style="flex-shrink: 0; display: flex; justify-content: center; width: 100%; max-width: 8rem; margin: 0 auto;">
          <img src="images/ohaka_bochi.webp" alt="Zombie Warning" style="width: 8rem; height: 8rem; object-fit: contain;" />
        </div>
        <div style="flex-grow: 1; min-width: 240px; text-align: left; display: flex; flex-direction: column; gap: 0.75rem;">
          <div style="font-weight: 900; color: #450a0a; font-size: 1.25rem; line-height: 1.4;">
            【AI Yamato's Lesson: A grave for an off-topic answer!】
          </div>
          <p style="color: #7f1d1d; font-size: 0.95rem; line-height: 1.5; font-weight: 600; margin: 0;">
            Even your hardest work becomes just scrap paper if you answer the wrong question. In the real exam, the assessor's red pen will strike without mercy.<br>
            Take a deep breath, and double-check your chosen prompt before you write!
          </p>
        </div>
      </div>
    `,
    `
      <div style="margin: 1.5rem 0; padding: 1.5rem; background-color: #fee2e2; border: 4px solid #ef4444; border-radius: 1.5rem; box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1); display: flex; align-items: center; gap: 1.5rem; flex-wrap: wrap;">
        <div style="flex-shrink: 0; display: flex; justify-content: center; width: 100%; max-width: 8rem; margin: 0 auto;">
          <img src="images/run_sagyouin_man_aseru.webp" alt="Running Direction Warning" style="width: 8rem; height: 8rem; object-fit: contain;" />
        </div>
        <div style="flex-grow: 1; min-width: 240px; text-align: left; display: flex; flex-direction: column; gap: 0.75rem;">
          <div style="font-weight: 900; color: #450a0a; font-size: 1.25rem; line-height: 1.4;">
            【AI Yamato's Lesson: The finish line is the other way!】
          </div>
          <p style="color: #7f1d1d; font-size: 0.95rem; line-height: 1.5; font-weight: 600; margin: 0;">
            The goal is that way! No matter how brilliantly you write in Japanese, you won't cross the finish line if you are running in the wrong direction.<br>
            Stop for a moment and reinstall today's theme firmly in your mind!
          </p>
        </div>
      </div>
    `
  ];

  const selectedWarningBlock = discrepancyWarnings[Math.floor(Math.random() * discrepancyWarnings.length)];

  const questionDisplay = assignedQuestion && assignedQuestion.trim() !== ""
    ? assignedQuestion
    : "None";

  return `
<CRITICAL_IMAGE_PROCESSING_AND_DISCREPANCY_RULES>
  - TRIGGER CONDITION: An image file of a handwritten response has been uploaded by the student.
  - ABSOLUTE OVERRIDE INSTRUCTION: When an image is attached, you MUST execute the following steps in strict order and format:

  <step_1_transcription_and_header>
    1. Read and transcribe the student's handwritten response directly from the uploaded image with high accuracy (cleanly format into readable lines without raw '\\n' strings).
    2. Count the exact number of Japanese characters from the transcribed text.
    3. Output the following items at the beginning of your response:
        [Question you chose] : "${questionDisplay}"
        [What you wrote] : <Insert a brief summary of the student's written response content here>
        [What to write] : 
          * Address the specific prompt requirements of "${questionDisplay}" accurately.
          * Present a coherent and appropriate text structure matching the required text type.
          * Clearly develop ideas and arguments relevant to the task.
        [Transcribed Text] : "<Insert your direct transcription of the student's handwritten Japanese response here>"
        [Character Count] : <Insert exact character count> characters
  </step_1_transcription_and_header>

  <step_2_mandatory_discrepancy_check>
    Compare the requirements and theme of [Question you chose] against the content summarized in [What you wrote]:

    - **CASE 0: No Question Selected**
      If [Question you chose] is "None" or empty, output ONLY this warning and TERMINATE immediately:
      ⚠ [Warning: No Question Selected]
      It looks like you haven't selected a question yet! Please select a task from the Task List on your dashboard by clicking the '🎯 Select for AI Tutor' button first, then upload your answer photo! 📋✨

    - **CASE 1: On-Topic (Matching Prompt)**
      If [What you wrote] genuinely addresses and aligns with the topic and requirements of [Question you chose]:
      Proceed immediately and directly in the very same response to output the comprehensive structured evaluation strictly following the active <pace_module_...> headers below!

    - **CASE 2: Discrepancy Detected (Off-Topic / Inconsistency)**
      If there is a mismatch, conflict, or significant inconsistency between [Question you chose] and [What you wrote] (e.g., the student's written content addresses an entirely different topic or ignores the prompt requirements):
      
      **MANDATORY TERMINATION ACTION**:
      Output ONLY the following Major Warning and **TERMINATE the response immediately**.
      You are **STRICTLY FORBIDDEN** from outputting any VCE Estimation Band, character count checks, key corrections, grammar refinements, teacher hints, or next actions!

      🔴 [Major Warning: Discrepancy Detected]
      There is a significant inconsistency or mismatch between [Question you chose] and [What you wrote]. In the actual VCE exam, writing about an irrelevant topic results in a severe penalty or zero for Content. Therefore, no detailed feedback or scoring will be provided. Please review [Question you chose] above, compare it with [What you wrote], and re-upload your work addressing the correct prompt.

      ${selectedWarningBlock}

      ⚠ [End of Session]
      Due to the prompt discrepancy and inconsistency between [Question you chose] and [What you wrote], this practice session has been terminated. Please select the correct task or upload the writing that matches the question you chose.
  </step_2_mandatory_discrepancy_check>
</CRITICAL_IMAGE_PROCESSING_AND_DISCREPANCY_RULES>
  `.trim();
}

/**
 * ★ ライティング特化のペース別インストラクション生成
 */
function getPaceInstruction(pace?: string, exactCharacterCount: number = 0): string {
  const activePace = (pace && pace.trim() !== "" ? pace : "normal").toLowerCase();

  const dualModeRule = `
<INPUT_INTENT_CLASSIFICATION_AND_DUAL_MODE_RULES>
  Determine the student's intent from the current message and session state:

  ### MODE A: Essay Submission / Revision (New Japanese draft or Image submitted)
  - If the student submits a new draft, an answer photo, or asks for a full evaluation of their Japanese text:
  - If on-topic (CASE 1), apply the structured format with exact headers defined in the active pace module below.

  ### MODE B: Follow-up Question / Discussion / Clarification (Conversational Q&A)
  - If the student asks a question (e.g., "Tell me about Japanese rivers", "How do I use this grammar?"):
  - DO NOT output evaluation headers (NO "[VCE-Aligned Estimation Band]", NO "[Character Count Check]").
  - Answer the question directly, warmly, and thoroughly in clear English with useful Japanese terms.
</INPUT_INTENT_CLASSIFICATION_AND_DUAL_MODE_RULES>
  `.trim();

  if (activePace.includes("accelerated")) {
    return `
${dualModeRule}
<active_pace_module>accelerated</active_pace_module>
<pace_module_accelerated>
- Profile & Tone: High achiever. Academic, rigorous, challenging, no fluff.
- Language: Strictly English (except quoted Japanese).
- Mode A (CASE 1 On-Topic Evaluation Structure):
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
- Mode A (CASE 1 On-Topic Evaluation Structure):
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
- Mode A (CASE 1 On-Topic Evaluation Structure):
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

  const syncedKnowledge = (await getSyncedKnowledge(env || (options as any)?.env)) as any;

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
    - Role: An expert VCE Japanese end-of-year examination writing coach and examiner mentor in Victoria, Australia. You guide Victorian secondary students through structured essay practice, text-type requirements, kanji precision, and advanced grammar to excel in their VCE external written exams.
  </identity>

  <persona_tone>
    - Tone and Demeanor: Encouraging, rigorous, academic, and deeply supportive. Act as an experienced VCE teacher.
    - CRITICAL LANGUAGE DIRECTIVE: Regardless of the student's input language, ALL feedback, error explanations, grammar breakdowns, and answers MUST be written strictly in English.
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
      * Guide students step-by-step by asking probing questions, pointing out formatting or structural areas to improve, and praising strong expressions to foster independent reasoning.
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