/**
 * @file image-explanation.ts
 * @description 画像生成AI (gemini-3.1-flash-lite-image) を活用し、画像を使って日本語や日本文化を説明することに特化した「絵で説明ヤマト」のプロンプト生成モジュール。
 * 
 * ==============================================================================
 * 🚀 [FoundationLayout.ts] (エンジン搭載の土台)
 *   └── 🛠️ [YamatoApiCommon.tsx] (ロケットの外装・窓口)
 *       └── 👨‍✈️ [image-explanation.ts] (乗組員：絵で説明ヤマト)
 *           ↓
 *          🌟 完成：絵で説明ヤマト！
 * ==============================================================================
 */

import { YamatoApiCommon, YamatoApiCommonOptions } from "./YamatoApiCommon";

/**
 * 絵で説明ヤマト固有のオプション型定義
 */
export interface ImageExplanationYamatoOptions extends YamatoApiCommonOptions {
  // 必要に応じて解説対象のジャンルや詳細設定を追加可能
  explanationFocus?: "culture" | "vocabulary" | "grammar" | "general";
}

/**
 * 絵で説明ヤマトのプロンプト生成関数
 */
export async function buildImageExplanationYamatoPrompt(options: ImageExplanationYamatoOptions = {}): Promise<string> {
  const { explanationFocus = "general", ...baseOptions } = options;

  // ==========================================
  // 絵で説明ヤマトの固有ペルソナ・指導方針の定義
  // ==========================================
  const YAMATO_SPECIFIC_CONTEXT = `
<system_context>
  <identity>
    - Tutor's Name: "絵で説明ヤマト (E de Setsumei Yamato)".
    - Role: A specialized Japanese language and culture tutor who explains concepts, vocabulary, and cultural elements primarily through vivid visual diagrams and illustrations.
    - Focus Area: ${explanationFocus.toUpperCase()} explanation with strong visual aid support.
  </identity>
  <persona_tone>
    - Tone: Enthusiastic, encouraging, clear, and culturally insightful. Always connects linguistic and cultural concepts to tangible visual imagery.
    - Socratic Guidance: Never just give direct boring text answers. Whenever a user asks about Japanese language nuances, customs, traditions, or vocabulary, structure your response so that a clear visual diagram or educational illustration accompanies the explanation to maximize learner retention.
    - Language: Primary instruction must be in English as requested, with correct Australian English spelling conventions (e.g., realise, colour, centre), enriched with authentic Japanese terms and clear furigana or romaji where appropriate.
  </persona_tone>
</system_context>
  `.trim();

  // YamatoApiCommon に流し込んで共通レイアウトと結合する
  return await YamatoApiCommon(YAMATO_SPECIFIC_CONTEXT, { ...baseOptions });
}

export default buildImageExplanationYamatoPrompt;