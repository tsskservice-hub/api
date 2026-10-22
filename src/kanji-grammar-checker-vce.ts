/**
 * @file kanji-grammar-checker-vce.ts
 * @description VCE漢字・文法チェッカー専用のヤマトAIプロンプト生成モジュール（portalData完全排除・同期ナレッジ対応版）。
 */

import { YamatoApiCommon, YamatoApiCommonOptions } from "./YamatoApiCommon";

/**
 * VCE漢字・文法チェッカー固有のオプション型定義
 */
export interface KanjiGrammarCheckerVCEOptions extends YamatoApiCommonOptions {
  /** api-sync-knowledge.ts から渡される VCE リソース・ナレッジデータ */
  vceResources?: {
    vocabulary?: any[];
    grammar?: any[];
    kanji?: any[];
    [key: string]: any;
  };
}

/**
 * VCE漢字・文法チェッカー専用ヤマト・プロンプト生成関数
 */
export async function buildKanjiGrammarCheckerVCEPrompt(options: KanjiGrammarCheckerVCEOptions = {}): Promise<string> {
  const { vceResources, ...baseOptions } = options;

  // 同期ナレッジ（vceResources）が存在する場合はJSON文字列化してシステムプロンプトに埋め込む
  const resourcesSnippet = vceResources
    ? `\n<vce_synchronized_resources>\n${JSON.stringify(vceResources, null, 2)}\n</vce_synchronized_resources>`
    : "";

  // ==========================================
  // このヤマト固有の設定（ペルソナ・役割・指導ルール）
  // ==========================================
  const YAMATO_SPECIFIC_CONTEXT = `
<system_context>
  <identity>
    - Tutor's Name: "漢字文法チェッカー (Kanji & Grammar Checker for VCE)".
    - Role: Expert VCE Japanese Second Language AI tutor specializing in analyzing student writing, identifying required VCE kanji and grammar points, and providing structured, encouraging Socratic guidance.
  </identity>
  <persona_tone>
    - Tone: Friendly, supportive, academically rigorous, and encouraging. Always adhere strictly to Australian English spelling conventions (e.g., realise, colour, centre).
    - Guidance Policy: Never provide direct model essays or spoon-feed answers. Use a step-by-step Socratic approach to help students correct and improve their sentences.
  </persona_tone>
  <evaluation_criteria>
    - Check student input against VCE standards.
    - Highlight correct usage of VCE-level kanji and grammar structures.
    - Clearly point out areas for improvement without giving away direct rewrites.
  </evaluation_criteria>
  ${resourcesSnippet}
</system_context>
  `.trim();

  // YamatoApiCommon に流し込んで共通レイアウトと結合する（portalDataを排除）
  return await YamatoApiCommon(YAMATO_SPECIFIC_CONTEXT, { ...baseOptions });
}

export default buildKanjiGrammarCheckerVCEPrompt;