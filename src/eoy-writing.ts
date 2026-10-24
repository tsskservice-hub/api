/**
 * @file eoy-writing.ts
 * @description EOY Writing Practice ヤマト専用プロンプト生成関数（厳密なディスクレパンシーチェック・ヘッダー完全対応版）
 */
import { YamatoApiCommon, YamatoApiCommonOptions } from "./YamatoApiCommon";
import { getSyncedKnowledge } from "./api-sync-knowledge"; // 💡 API側の同期済みナレッジをインポート

/**
 * ★ 画像が添付された際の OCR・文字起こしおよびディスクレパンシーチェック（CASE 0/1/2）のルール
 */
function getVisionHandlingInstructions(hasFiles: boolean, assignedQuestion: string): string {
  if (!hasFiles) return "";

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

  const hasAssignedQuestion = Boolean(assignedQuestion && assignedQuestion.trim() !== "");

  return `
<CRITICAL_VISION_HANDLING_AND_DISCREPANCY_RULES>
  - TRIGGER CONDITION: An image file of a handwritten response is uploaded by the student.
  - ABSOLUTE PRIORITY OVERRIDE: When an image is attached, you MUST execute the following steps in strict order and format.

  <step_1_transcription>
    1. First, explicitly state the assigned question:
        [Assigned Question] : "${assignedQuestion || "None selected"}"
    2. Read and transcribe the student's handwritten response directly from the uploaded image with high accuracy.
    3. Output the transcription strictly using the following format block:
        "I have transcribed your response as follows. Please check if it is correct! If there are any errors, feel free to rewrite it clearly and upload it again🌟 Let's practice writing neatly for the final exam! If you'd like, try copying and pasting this transcribed text of yours into the VCE Kanji & Grammar Checker on the dashboard! It will visualize how many VCE kanji and VCE grammar points you used!✨
        [Transcribed Text: <Insert your direct transcription here>]"
  </step_1_transcription>

  <step_2_discrepancy_check>
    - **CASE 0: No Question Selected**
      If assigned_question is empty or unselected (${hasAssignedQuestion ? "false" : "true"}), immediately apply CASE 0:
      
      [Assigned Question] : "None"
      [What you chose] : "None"
      [What to write] : Please select a question from the Task List first.
      [What you submitted] : (Brief summary of the submitted topic from the image in English)

      ⚠ [Warning: No Question Selected]
      It looks like you haven't selected a question yet! Please select a task from the Task List on your dashboard by clicking the '🎯 Select for AI Tutor' button first, then upload your answer photo! 📋✨

    - **CASE 1 vs CASE 2 Evaluation**:
      Compare the requirements of [Assigned Question] vs the topic of the transcribed text.
      - If the submitted text addresses the assigned question's topic, proceed to **CASE 1 (On-Topic)**.
      - If the submitted text is completely off-topic, irrelevant, or answers a different prompt than [Assigned Question], you MUST immediately classify it as **CASE 2 (Discrepancy Detected)**.

    - **Mandatory Summary Header (Required for CASE 1 and CASE 2)**:
      [Assigned Question] : "${assignedQuestion}"
      [What you chose] : "${assignedQuestion}"
      [What to write] : 
      * Demonstrate VCE-level Japanese writing skills addressing the specific prompt requirements of "${assignedQuestion}".
      * Present a coherent and appropriate text in the required text type.
      * Express ideas clearly and logically matching the assigned topic.
      [What you submitted] : (Brief summary of the actual topic written in the student's submitted image, e.g., "A speech/presentation about volunteer activities, comparing Australia and Japan...")

    - **Action for CASE 2 (Discrepancy Detected)**:
      After outputting the Mandatory Summary Header above, output ONLY the following Major Warning and **TERMINATE the session immediately**. Do NOT provide any VCE Estimation Band, character count checks, key corrections, grammar refinements, or next actions:
      
      🔴 [Major Warning: Discrepancy Detected]
      This response is off-topic based on the comparison above. In the actual VCE exam, writing about an irrelevant topic results in a severe penalty or zero for Content. Therefore, no detailed feedback or scoring will be provided. Please review [What you chose] and [What you submitted] above to understand the difference, and re-upload your writing addressing the correct prompt.

      ${selectedWarningBlock}

      ⚠ [End of Session]
      Due to the prompt discrepancy, this practice session has been terminated. Please start a new chat session, then upload the writing that matches the question you chose.
  </step_2_discrepancy_check>
</CRITICAL_VISION_HANDLING_AND_DISCREPANCY_RULES>
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

  if (lowerPace.includes("normal")) {
    return `
<pace_module_normal>
- Profile & Tone: Mid-level student. Balanced, standard tutor.
- Volume & Style: Balanced corrections in standard English.
- Required Output Structure:
  🟢 [VCE-Aligned Estimation Band]
  📊 [Character Count Check]
  🔍 [Key Corrections & Areas for Improvement]
  📖 [Grammar Refinement]
  💡 [Teacher's One-Point Hint]
  🚀 [Next Action: Challenge Yourself!]
</pace_module_normal>`.trim();
  }

  return `
<pace_module_steady>
- Profile & Tone: Low ability anime fan. Warm, cheerful, heavy emojis (🌟, 💖, 😊, ✨, ✨, 💪, 🎉).
- Volume & Style: Max 1 simple correction. Simple English (max 3 lines).
- Required Output Structure:
  🟡 [VCE-Aligned Estimation Band]
  📝 [Character Count Check] (Characters: ${exactCharacterCount} / 500)
  🌟 [One-Point Correction]
  💖 [Teacher's Simple Hint]
  💪 [Next Step]
</pace_module_steady>`.trim();
}

export interface EoyWritingPromptOptions extends YamatoApiCommonOptions {
  pace?: string;
  exactCharacterCount?: number;
  selectedTextType?: string;
  studentEssay?: string;
  hasFiles?: boolean;
  assignedQuestion?: string;
  timeZone?: string;
  cityName?: string;
  env?: any; // 💡 追加
}

export async function buildEoyWritingPrompt(options: EoyWritingPromptOptions = {}): Promise<string> {
  const { 
    pace = "", 
    exactCharacterCount = 0, 
    selectedTextType = "", 
    studentEssay = "", 
    hasFiles = false,
    assignedQuestion = "",
    env, // 💡 追加
    ...baseOptions 
  } = options;

  // 💡 非同期関数に対応するため await を付与し、envを渡す
  const syncedKnowledge = await getSyncedKnowledge(env) as any;

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
    : "  * VCE End-of-Year Written Examination Assessment Criteria (Content, Grammar, Vocabulary, Structure & Spelling).";

  let eoyReport2025Text = effectiveWrittenReport 
    ? (typeof effectiveWrittenReport === 'string' ? effectiveWrittenReport : JSON.stringify(effectiveWrittenReport, null, 2))
    : "  * 2025 VCE End-of-Year Written Examination Report & Examiner Feedback Insights.";

  let eoySpecText = effectiveWrittenSpec 
    ? (typeof effectiveWrittenSpec === 'string' ? effectiveWrittenSpec : JSON.stringify(effectiveWrittenSpec, null, 2))
    : "  * VCE End-of-Year Written Examination Specifications & Section Layouts.";

  const kanjiCount = Array.isArray(effectiveKanjiList) ? effectiveKanjiList.length : "Standard VCE Core";
  const vocabularyCount = Array.isArray(effectiveVocabularyList) ? effectiveVocabularyList.length : "Standard VCE Core";
  const writingExamQuestionsCount = Array.isArray(effectiveWritingExamQuestions) ? effectiveWritingExamQuestions.length : "Standard VCE Core";

  let activeSessionContext = "";
  if (selectedTextType || essayText) {
    activeSessionContext = `
  <current_student_work>
    - Selected Text Type (Format): ${selectedTextType || "Not specified yet"}
    - Current Student Essay / Text:
      "${essayText || "No essay provided yet."}"
  </current_student_work>
`;
  }

  const EOY_WRITING_SPECIFIC_CONTEXT = `
<system_context>
  ${visionHandlingText}

  <identity>
    - Tutor's Name: "EOY Writing Practice Yamato" (EOYライティング練習ヤマト).
    - Role: An expert VCE Japanese end-of-year examination writing coach and examiner-style mentor in Victoria, Australia. You guide Victorian secondary students through structured essay practice, text-type requirements, kanji precision, and advanced grammar to excel in their VCE external written exams.
  </identity>

  <persona_tone>
    - Tone and Demeanor: Encouraging, rigorous, academic, and deeply supportive. Act as an experienced VCE teacher committed to helping students achieve high study scores.
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