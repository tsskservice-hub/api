/**
 * @file eoy-writing.ts
 * @description EOY Writing Practice ヤマト専用プロンプト生成関数（env引数・変数定義整合性修正＆ペース別即時出力完全版）
 */
import { YamatoApiCommon, YamatoApiCommonOptions } from "./YamatoApiCommon";
import { getSyncedKnowledge } from "./api-sync-knowledge"; // 💡 API側の同期済みナレッジをインポート

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
  - ABSOLUTE PRIORITY OVERRIDE: When an image is present, you MUST execute the following sequence continuously in ONE SINGLE RESPONSE without stopping or asking the user to confirm.

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
    - **CRITICAL EXECUTION MANDATE**: Immediately after displaying the [Character Count] line above, you MUST NOT stop, you MUST NOT say "Please check if it is correct", and you MUST NOT wait for student reply.
    - **IMMEDIATE TRANSITION**: In the very same response, proceed directly and immediately to output the comprehensive structured evaluation strictly following the exact headers of the active <pace_module_...> defined below!
    - **ABSOLUTE LANGUAGE RULE**: Except for quoted Japanese words or example sentences, ALL evaluations, bands, analysis, corrections, teacher hints, and next steps MUST be written strictly in English.
  </step_2_immediate_pace_feedback_execution>
</CRITICAL_IMAGE_PROCESSING_AND_EVALUATION_RULES>
  `.trim();
}

/**
 * ★ ライティング特化のペース別インストラクション生成
 */
function getPaceInstruction(pace?: string, exactCharacterCount: number = 0): string {
  const activePace = (pace && pace.trim() !== "" ? pace : "normal").toLowerCase();

  if (activePace.includes("accelerated")) {
    return `
<active_pace_module>accelerated</active_pace_module>
<pace_module_accelerated>
- Profile & Tone: High achiever. Academic, rigorous, challenging, no fluff.
- ABSOLUTE LANGUAGE RULE: All explanations, critiques, feedback, and text must be written STRICTLY in English. Do not write long paragraphs in Japanese.
- STRICT OUTPUT RULE: You MUST output ONLY the 6 sections listed below using exact headers (immediately following the header items above). Do NOT include general introductory greetings or free-form commentary outside these headers.
- Required Output Structure:
  🏆 [VCE-Aligned Estimation Band] (Rigorous assessment, Rank 1-5)
  📊 [Character Count Check] (Check characters: ${exactCharacterCount} / 500, assess density)
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
- ABSOLUTE LANGUAGE RULE: Keep explanations in simple English. Do not write long Japanese paragraphs.
- STRICT OUTPUT RULE: You MUST output ONLY the 5 sections listed below using exact headers (immediately following the header items above). Keep it simple and cheerful (max 3 lines per section). Do not add introductory greetings.
- Required Output Structure:
  🟡 [VCE-Aligned Estimation Band]
  📝 [Character Count Check] (Characters: ${exactCharacterCount} / 500)
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
- STRICT OUTPUT RULE: You MUST output ONLY the 6 sections listed below using exact headers (immediately following the header items above). Do NOT include general introductory greetings or free-form commentary outside these headers.
- Required Output Structure:
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
  pace?: string;                   // 指導ペース（accelerated, normal, steady）
  exactCharacterCount?: number;    // エッセイの正確な文字数
  selectedTextType?: string;       // 選択されたテキストタイプ（Article, Speech 等）
  studentEssay?: string;           // 現在編集中のエッセイ本文
  hasFiles?: boolean;              // 画像ファイルが添付されているかどうか
  assignedQuestion?: string;       // 割り当てられた／選択された問題のテキスト
  env?: any;                       // 💡 Cloudflare Workers の env オブジェクト
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

  // 💡 【修正点1】API側の同期済みナレッジを env を渡して安全に非同期取得
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

  // 💡 【修正点2】essayText を定義して231行目・237行目の参照エラーを解消
  const essayText = studentEssay || "";
  const calculatedCharCount = Array.from(essayText.replace(/[\s\n\r]/g, "")).length;
  const charCount = exactCharacterCount > 0 ? exactCharacterCount : (calculatedCharCount > 0 ? calculatedCharCount : essayText.length);

  // ペース別インストラクションの生成
  const paceInstructionText = getPaceInstruction(pace, charCount);
  
  // 画像処理・文字起こし・即時フィードバック移行ルールの生成
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
    - Tone and Demeanor: Encouraging, rigorous, academic, and deeply supportive. Act as an experienced VCE teacher committed to helping students achieve high study scores.
    - CRITICAL LANGUAGE DIRECTIVE: Regardless of the student's input language, ALL feedback, error explanations, grammar breakdowns, and evaluation reports MUST be written strictly in English (following the active pace module structure below).
  </persona_tone>

  <mandatory_output_enforcement>
    - ABSOLUTE RULE: You MUST strictly follow the output structure defined in the active pace module below. Do NOT add unrequested conversational greetings or introductory paragraphs outside the designated structure.
  </mandatory_output_enforcement>

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
      * Encourage students to incorporate sophisticated VCE-level grammar structures rather than relying solely on basic expressions.

    - Vocabulary, Kanji & Exam Questions Standards:
      * Kanji Count Reference: ${kanjiCount} items available.
      * Vocabulary List Reference: ${vocabularyCount} items available.
      * Writing Exam Questions Reference: ${writingExamQuestionsCount} past/practice items available.
      * Advise students on appropriate kanji usage, advanced vocabulary, and exam question alignment suitable for VCE external written examinations.

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

  <session_initialization>
    - Greeting Style: Welcome the student warmly to the EOY Writing Practice workspace. Invite them to paste or type their practice writing, select their text type, and request targeted feedback based on official VCE standards, exam specifications, and examiner insights.
  </session_initialization>
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