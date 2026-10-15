/**
 * @file genkoyoshi-editor-vce.ts
 * @description VCE原稿用紙エディターヤマト専用プロンプト生成関数（漢字・文法・語彙・テキストタイプ・各種VCE基準データ完全連動版）
 */
import { buildBaseSystemPrompt, SystemPromptOptions } from "./base-rules";
import { getFormattedTimeForZone } from "./time-utils";
import { getCityWeatherContext } from "./weather-utils";

/**
 * フロントエンド（yamato-portal）から動的に渡されるVCE原稿用紙データの型定義
 */
export interface VceGenkoyoshiPortalData {
  studentName?: string;
  selectedTextType?: string;     // 選択されたテキストタイプ（Evaluative, Persuasive, Imaginative 等）
  studentEssay?: string;         // 現在編集中の文章
  kanjiList?: Array<any>;        // kanji-list.json のデータを受け取る
  textTypes?: Array<{ name?: string; type?: string; description?: string }>; // texttypes.json のデータを受け取る
  grammarList?: any;             // vce-grammar-list.ts のデータを受け取る
  vocabList?: Array<any>;        // vce-vocabulary-list.json のデータを受け取る
  writingStyles?: any;           // writing-styles.ts のデータを受け取る
  u3o3Descriptor?: any;          // vce-u3o3-descriptor.ts のデータを受け取る
  u4o3Descriptor?: any;          // vce-u4o3-descriptor.ts のデータを受け取る
  eoyWrittenCriteria?: any;      // vce-eoy-written-criteria.ts のデータを受け取る
  timeZone?: string;
  cityName?: string;
}

/**
 * VCE原稿用紙プロンプト生成用のオプション（共通オプション + VCEポータルデータ）
 */
export interface VceGenkoyoshiPromptOptions extends SystemPromptOptions {
  portalData?: VceGenkoyoshiPortalData;
}

/**
 * VCE原稿用紙エディターヤマト固有のアイデンティティと、動的VCEデータを組み込む関数
 */
export async function buildVceGenkoyoshiPrompt(options: VceGenkoyoshiPromptOptions = {}): Promise<string> {
  const { portalData = {}, ...baseOptions } = options;

  // タイムゾーンと時間の取得
  const timeZone = portalData.timeZone || "Australia/Melbourne";
  const timeContext = getFormattedTimeForZone(timeZone);

  // 天気情報の取得
  let weatherContext = "Fine, 20°C";
  try {
    const weather = await getCityWeatherContext(portalData.cityName || "Melbourne");
    weatherContext = weather ? String(weather) : "Fine, 20°C";
  } catch (e: any) {
    console.warn("⚠️ [genkoyoshi-editor-vce.ts] 天気情報の取得に失敗しました:", e.message);
  }

  // 1. テキストタイプデータ（texttypes.json）のテキスト化
  let textTypesText = "";
  if (portalData.textTypes && Array.isArray(portalData.textTypes) && portalData.textTypes.length > 0) {
    textTypesText = portalData.textTypes
      .map((t) => `  * ${t.name || t.type}: ${t.description || "VCE text type guideline"}`)
      .join("\n");
  } else {
    textTypesText = `
  * Evaluative / Reflective (評価・振り返り)
  * Persuasive / Argumentative (説得・論説)
  * Imaginative / Creative (創造的・物語)
  * Informative / Expository (説明・報告)
  * Personal / Recount (個人的な回想・手紙)`;
  }

  // 2. VCE文法リスト（vce-grammar-list.ts）のテキスト化
  let grammarText = "";
  if (portalData.grammarList) {
    if (Array.isArray(portalData.grammarList)) {
      grammarText = portalData.grammarList
        .map((g: any) => `  * ${g.title || g.item || JSON.stringify(g)}`)
        .join("\n");
    } else if (typeof portalData.grammarList === 'object') {
      grammarText = Object.entries(portalData.grammarList)
        .map(([key, val]: [string, any]) => `  * ${key}: ${val?.description || JSON.stringify(val)}`)
        .join("\n");
    }
  } else {
    grammarText = "  * Official VCE Grammar structures (e.g., conditionals, passive/causative, conjecture expressions)";
  }

  // 3. ライティングスタイル（writing-styles.ts）のテキスト化
  let writingStylesText = "";
  if (portalData.writingStyles) {
    if (typeof portalData.writingStyles === 'string') {
      writingStylesText = portalData.writingStyles;
    } else if (typeof portalData.writingStyles === 'object') {
      writingStylesText = JSON.stringify(portalData.writingStyles, null, 2);
    }
  } else {
    writingStylesText = "  * Appropriate Register, tone, honorifics (Keigo), and stylistic conventions for VCE writing tasks.";
  }

  // 4. Unit 3 Outcome 3 ディスクリプター（vce-u3o3-descriptor.ts）のテキスト化
  let u3o3Text = portalData.u3o3Descriptor 
    ? (typeof portalData.u3o3Descriptor === 'string' ? portalData.u3o3Descriptor : JSON.stringify(portalData.u3o3Descriptor, null, 2))
    : "  * VCE Unit 3 Outcome 3 assessment standards and performance descriptors.";

  // 5. Unit 4 Outcome 3 ディスクリプター（vce-u4o3-descriptor.ts）のテキスト化
  let u4o3Text = portalData.u4o3Descriptor 
    ? (typeof portalData.u4o3Descriptor === 'string' ? portalData.u4o3Descriptor : JSON.stringify(portalData.u4o3Descriptor, null, 2))
    : "  * VCE Unit 4 Outcome 3 assessment standards and performance descriptors.";

  // 6. 期末筆記試験採点基準（vce-eoy-written-criteria.ts）のテキスト化
  let eoyCriteriaText = portalData.eoyWrittenCriteria 
    ? (typeof portalData.eoyWrittenCriteria === 'string' ? portalData.eoyWrittenCriteria : JSON.stringify(portalData.eoyWrittenCriteria, null, 2))
    : "  * VCE End-of-Year Written Examination Assessment Criteria (Content, Grammar, Vocabulary, Structure & Spelling).";

  // 7. 漢字・語彙カウント
  const kanjiCount = portalData.kanjiList && Array.isArray(portalData.kanjiList) ? portalData.kanjiList.length : "Standard VCE Core";
  const vocabCount = portalData.vocabList && Array.isArray(portalData.vocabList) ? portalData.vocabList.length : "VCE Core";

  // 生徒が選択しているテキストタイプやエッセイ本文がある場合の動的セッション情報
  let activeSessionContext = "";
  if (portalData.selectedTextType || portalData.studentEssay) {
    activeSessionContext = `
  <current_student_work>
    - Selected Text Type: ${portalData.selectedTextType || "Not specified yet"}
    - Current Student Essay / Text:
      "${portalData.studentEssay || "No essay provided yet."}"
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

  <current_environmental_context>
    - Current Time & Date: ${timeContext}
    - Current Weather: ${weatherContext}
  </current_environmental_context>
${activeSessionContext}
  <vce_curriculum_knowledge_base>
    - Supported Text Types & Guidelines:
${textTypesText}
      * Guide students to adhere strictly to the conventions, Register, and tone required for each VCE text type.

    - Writing Styles & Conventions (writing-styles.ts):
${writingStylesText}

    - VCE Grammar Standards:
${grammarText}
      * Encourage students to incorporate sophisticated VCE-level grammar structures rather than relying solely on basic expressions.

    - Vocabulary & Kanji Standards (Kanji Count: ${kanjiCount}, VCE Vocab Items: ${vocabCount}):
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
    - Greeting Style: Welcome the student warmly to the VCE Genkoyoshi workspace. Invite them to paste or type their Japanese writing, specify their text type, and ask for targeted feedback on grammar, kanji, or structure according to VCE standards.
  </session_initialization>
</system_context>
`.trim();

  return buildBaseSystemPrompt(VCE_GENKOYOSHI_SPECIFIC_CONTEXT, baseOptions);
}

export default buildVceGenkoyoshiPrompt;