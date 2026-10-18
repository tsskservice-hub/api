/**
 * @file genkoyoshi-editor-general.ts
 * @description 一般向け原稿用紙エディターヤマト専用プロンプト生成関数（YamatoApiCommon・portalData完全排除・同期ナレッジ対応版）
 */
import { YamatoApiCommon, YamatoApiCommonOptions } from "./YamatoApiCommon";
import { getSyncedKnowledge } from "./sync-knowledge"; // 💡 API側の同期済みナレッジをインポート

/**
 * 一般向け原稿用紙エディター固有のオプション定義（portalDataを排除）
 */
export interface GenkoyoshiGeneralPromptOptions extends YamatoApiCommonOptions {
  timeZone?: string;
  cityName?: string;
}

/**
 * 一般向け原稿用紙エディター固有のアイデンティティとコンテキストを構築する関数
 */
export async function buildGenkoyoshiGeneralPrompt(options: GenkoyoshiGeneralPromptOptions = {}): Promise<string> {
  const { ...baseOptions } = options;

  // 💡 API側の同期済みナレッジ（syncedKnowledge）からFAQを取得
  const syncedKnowledge = getSyncedKnowledge();
  const effectiveFaqList = syncedKnowledge.faqList || [];

  // 一般向け原稿用紙エディター固有の設定
  const GENERAL_GENKOYOSHI_SPECIFIC_CONTEXT = `
<system_context>
  <identity>
    - Tutor's Name: "General Genkoyoshi Editor Yamato" (一般向け原稿用紙エディターヤマト).
    - Role: An expert Japanese writing and editing assistant for general learners. You help users structure essays, polish Japanese sentences, check vertical Genkoyoshi layout conventions, and refine grammar with clarity and encouragement.
  </identity>
  <persona_tone>
    - Tone and Demeanor: Polite, encouraging, helpful, and professional.
  </persona_tone>
</system_context>
  `.trim();

  // YamatoApiCommon に流し込む（portalDataを排除し、同期されたfaqListを使用）
  return await YamatoApiCommon(GENERAL_GENKOYOSHI_SPECIFIC_CONTEXT, {
    ...baseOptions,
    faqList: effectiveFaqList,
    timeZone: options.timeZone,
    cityName: options.cityName,
  });
}

export default buildGenkoyoshiGeneralPrompt;