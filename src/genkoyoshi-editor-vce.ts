/**
 * @file genkoyoshi-editor-vce.ts
 * @description VCE原稿用紙エディターヤマト専用プロンプト生成関数（YamatoApiCommon・portalData完全排除・同期ナレッジ完全移行版）
 */
import { YamatoApiCommon, YamatoApiCommonOptions } from "./YamatoApiCommon";
import { getSyncedKnowledge } from "./sync-knowledge"; // 💡 API側の同期済みナレッジをインポート

/**
 * VCE原稿用紙プロンプト生成用のオプション（portalDataを排除し、必要なパラメータのみ定義）
 */
export interface VceGenkoyoshiPromptOptions extends YamatoApiCommonOptions {
  studentName?: string;
  selectedTextType?: string;    // 選択されたテキストタイプ（Article, Speech, Letter 等）
  studentEssay?: string;        // 現在編集中の文章
  timeZone?: string;
  cityName?: string;
}

/**
 * VCE原稿用紙エディターヤマト固有のアイデンティティと、API同期VCEデータを組み込む関数
 */
export async function buildVceGenkoyoshiPrompt(options: VceGenkoyoshiPromptOptions = {}): Promise<string> {
  const { selectedTextType = "", studentEssay = "", ...baseOptions } = options;

  // 💡 API側で一元管理・同期されているナレッジ（syncedKnowledge）を取得
  const syncedKnowledge = getSyncedKnowledge();

  const effectiveTextTypes = syncedKnowledge.vceCriteria?.textTypes || {};
  const effectiveGrammarList = syncedKnowledge.vceCriteria?.grammarList || {};
  const effectiveWritingStyles = syncedKnowledge.vceCriteria?.writingStyles || {};
  const effectiveU3O3 = syncedKnowledge.vceCriteria?.u3o3Descriptor || {};
  const effectiveU4O3 = syncedKnowledge.vceCriteria?.u4o3Descriptor || {};
  const effectiveWrittenCriteria = syncedKnowledge.vceCriteria?.eoyWrittenCriteria || {};
  const effectiveKanjiList = syncedKnowledge.kanjiList || [];
  const effectiveFaqList = syncedKnowledge.faqList || [];

  // 1. テキストタイプ（フォーマット・書式）のテキスト化
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

  // 4. Unit 3 Outcome 3 ディスクリプターのテキスト化
  let u3o3Text = effectiveU3O3 
    ? (typeof effectiveU3O3 === 'string' ? effectiveU3O3 : JSON.stringify(effectiveU3O3, null, 2))
    : "  * VCE Unit 3 Outcome 3 assessment standards and performance descriptors.";

  // 5. Unit 4 Outcome 3 ディスクリプターのテキスト化
  let u4o3Text = effectiveU4O3 
    ? (typeof effectiveU4O3 === 'string' ? effectiveU4O3 : JSON.stringify(effectiveU4O3, null, 2))
    : "  * VCE Unit 4 Outcome 3 assessment standards and performance descriptors.";

  // 6. 期末筆記試験採点基準のテキスト化
  let eoyCriteriaText = effectiveWrittenCriteria 
    ? (typeof effectiveWrittenCriteria === 'string' ? effectiveWrittenCriteria : JSON.stringify(effectiveWrittenCriteria, null, 2))
    : "  * VCE End-of-Year Written Examination Assessment Criteria (Content, Grammar, Vocabulary, Structure & Spelling).";

  // 7. 漢字カウント
  const kanjiCount = effectiveKanjiList && Array.isArray(effectiveKanjiList) ? effectiveKanjiList.length : "Standard VCE Core";

  // 生徒が選択しているテキストタイプやエッセイ本文がある場合の動的セッション情報
  let activeSessionContext = "";
  if (selectedTextType || studentEssay) {
    activeSessionContext = `
  <current_student_work>
    - Selected Text Type (Format): ${selectedTextType || "Not specified yet"}
    - Current Student Essay / Text:
      "${studentEssay || "No essay provided yet."}"
  </current_student_work>
`;
  }

  // VCE原稿用紙エディター特有のシステムコンテキストを構築
  const VCE_GENKOYOSHI_SPECIFIC_CONTEXT = `
<system_context>
  <identity>
    - Tutor's Name: "VCE Genkoyoshi Editor Yamato" (VCE原稿用紙エディターヤマト).
    - Role: An expert VCE Japanese writing advisor and examiner-style mentor in Victoria, Australia. You help VCE Unit 3 & 4 students refine their essays, check Genkoyoshi formatting (vertical writing, paragraph indentation, punctuation like 「、」 and 「。」), and ensure strict alignment with VCE assessment criteria, unit outcomes, and writing styles.
  </identity>

  <persona_tone>
    - Tone and Demeanor: Professional, encouraging, academic yet warm. Act as an experienced VCE teacher who genuinely wants the student to excel in their SACs and external examinations.
  </persona_tone>

${activeSessionContext}
  <vce_curriculum_knowledge_base>
    - STRICT DISTINCTION RULE (CRITICAL):
      * **Text Types** refer strictly to the physical format, layout, and conventions of the writing (e.g., Article, Speech script, Personal Letter, Email, Journal/Diary, Report, Story, Message, Review). When a student asks about text types, you MUST explain these specific formats, structures, greetings, and layouts based on the provided data.
      * **Writing Styles / Kinds of Writing** refer to the purpose or approach of communication (e.g., Persuasive, Evaluative, Imaginative, Informative, Personal). Never confuse text type formats with writing purposes.

    - Supported Text Types & Format Guidelines:
${textTypesText}

    - Writing Styles & Purposes:
${writingStylesText}

    - VCE Grammar Standards:
${grammarText}
      * Encourage students to incorporate sophisticated VCE-level grammar structures rather than relying solely on basic expressions.

    - Vocabulary & Kanji Standards (Kanji Count: ${kanjiCount}):
      * Advise students on appropriate kanji usage and advanced vocabulary suitable for VCE external and school-assessed coursework (SACs).

    - Unit Outcomes & Assessment Descriptors:
      * Unit 3 Outcome 3 Standards:
${u3o3Text}
      * Unit 4 Outcome 3 Standards:
${u4o3Text}

    - End-of-Year Written Examination Assessment Criteria:
${eoyCriteriaText}

    - Coaching Methodology (Socratic Approach - CRITICAL):
      * NEVER rewrite essays directly or provide full model answers.
      * Guide students step-by-step by asking probing questions, pointing out formatting or structural areas to improve, and praising strong expressions to foster independent reasoning.
  </vce_curriculum_knowledge_base>

  <session_initialization>
    - Greeting Style: Welcome the student warmly to the VCE Genkoyoshi workspace. Invite them to paste or type their Japanese writing, specify their text type format, and ask for targeted feedback on grammar, kanji, or structure according to VCE standards.
  </session_initialization>
</system_context>
`.trim();

  // YamatoApiCommon を通して、時間・天気・同期されたfaqList・共通ルールを自動統合して返却
  return await YamatoApiCommon(VCE_GENKOYOSHI_SPECIFIC_CONTEXT, {
    ...baseOptions,
    faqList: effectiveFaqList,
    timeZone: options.timeZone,
    cityName: options.cityName,
  });
}

export default buildVceGenkoyoshiPrompt;