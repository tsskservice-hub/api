/**
 * @file eoy-writing.ts
 * @description EOY Writing Practice ヤマト専用プロンプト生成関数（YamatoApiCommon・portalData完全排除・同期ナレッジ完全移行版）
 */
import { YamatoApiCommon, YamatoApiCommonOptions } from "./YamatoApiCommon";
import { getSyncedKnowledge } from "./api-sync-knowledge"; // 💡 API側の同期済みナレッジをインポート

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

/**
 * EOY Writing Practice プロンプト生成用のオプション（portalDataを排除しシンプルに定義）
 */
export interface EoyWritingPromptOptions extends YamatoApiCommonOptions {
  pace?: string;                   // 指導ペース（accelerated, normal, steady）
  exactCharacterCount?: number;    // エッセイの正確な文字数
  selectedTextType?: string;       // 選択されたテキストタイプ（Article, Speech 等）
  studentEssay?: string;           // 現在編集中のエッセイ本文
  timeZone?: string;
  cityName?: string;
}

/**
 * EOY Writing Practice ヤマト固有のアイデンティティと、API側同期ナレッジを組み込む関数
 */
export async function buildEoyWritingPrompt(options: EoyWritingPromptOptions = {}): Promise<string> {
  const { pace = "", exactCharacterCount = 0, selectedTextType = "", studentEssay = "", ...baseOptions } = options;

  // 💡 API側の同期済みナレッジ（syncedKnowledge）を直接取得
  const syncedKnowledge = getSyncedKnowledge();

  const effectiveTextTypes = syncedKnowledge.vceCriteria?.textTypes || {};
  const effectiveGrammarList = syncedKnowledge.vceCriteria?.grammarList || {};
  const effectiveWritingStyles = syncedKnowledge.vceCriteria?.writingStyles || {};
  const effectiveWrittenCriteria = syncedKnowledge.vceCriteria?.eoyWrittenCriteria || {};
  const effectiveWrittenReport = syncedKnowledge.vceCriteria?.eoyWrittenReport2025 || {};
  const effectiveWrittenSpec = syncedKnowledge.vceCriteria?.eoyWrittenSpec || {};
  const effectiveKanjiList = syncedKnowledge.kanjiList || [];
  const effectiveFaqList = syncedKnowledge.faqList || [];

  const essayText = studentEssay;
  const charCount = exactCharacterCount > 0 ? exactCharacterCount : essayText.length;

  // ペース別インストラクションの生成
  const paceInstructionText = getPaceInstruction(pace, charCount);

  // 1. テキストタイプ（texttypes.json：フォーマット・書式）のテキスト化
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

  // 7. 漢字カウント
  const kanjiCount = effectiveKanjiList && Array.isArray(effectiveKanjiList) ? effectiveKanjiList.length : "Standard VCE Core";

  // 生徒が選択しているテキストタイプやエッセイ本文がある場合の動的セッション情報
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

  // EOY Writing Practice 固有のシステムコンテキストを構築
  const EOY_WRITING_SPECIFIC_CONTEXT = `
<system_context>
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

    - Vocabulary & Kanji Standards (Kanji Count: ${kanjiCount}):
      * Advise students on appropriate kanji usage and advanced vocabulary suitable for VCE external written examinations.

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

  // YamatoApiCommon を通して、時間・天気・FAQ・共通ルールを自動統合して返却
  return await YamatoApiCommon(EOY_WRITING_SPECIFIC_CONTEXT, {
    ...baseOptions,
    faqList: effectiveFaqList,
    timeZone: options.timeZone,
    cityName: options.cityName,
  });
}

export default buildEoyWritingPrompt;