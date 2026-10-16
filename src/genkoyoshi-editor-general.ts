/**
 * @file genkoyoshi-editor-general.ts
 * @description 一般向け原稿用紙エディターヤマト専用プロンプト生成関数（YamatoApiCommon完全連動版）
 */
import { YamatoApiCommon, YamatoApiCommonOptions } from "./YamatoApiCommon";

/**
 * 一般向け原稿用紙エディター固有のオプション定義
 */
export interface GenkoyoshiGeneralPromptOptions extends YamatoApiCommonOptions {
  // 独自のオプションがあればここに定義
}

/**
 * 一般向け原稿用紙エディター固有のアイデンティティとコンテキストを構築する関数
 */
export async function buildGenkoyoshiGeneralPrompt(options: GenkoyoshiGeneralPromptOptions = {}): Promise<string> {
  const { portalData = {}, ...baseOptions } = options;

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

  // YamatoApiCommon に流し込む
  return await YamatoApiCommon(GENERAL_GENKOYOSHI_SPECIFIC_CONTEXT, {
    portalData,
    faqList: portalData?.faqList,
    timeZone: portalData?.timeZone,
    cityName: portalData?.cityName,
    ...baseOptions,
  });
}

export default buildGenkoyoshiGeneralPrompt;