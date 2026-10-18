/**
 * @file game-igo.ts
 * @description 囲碁ヤマト専用プロンプト生成関数（YamatoApiCommon・portalData完全排除・同期ナレッジ対応版）
 */
import { YamatoApiCommon, YamatoApiCommonOptions } from "./YamatoApiCommon";
import { getSyncedKnowledge } from "./sync-knowledge"; // 💡 API側の同期済みナレッジをインポート

/**
 * 囲碁ヤマト固有のオプション定義（portalDataを排除）
 */
export interface GameIgoOptions extends YamatoApiCommonOptions {
  timeZone?: string;
  cityName?: string;
}

/**
 * 囲碁ヤマト固有のアイデンティティとコンテキストを構築する関数
 */
export async function buildGameIgoPrompt(options: GameIgoOptions = {}): Promise<string> {
  const { ...baseOptions } = options;

  // 💡 API側の同期済みナレッジ（syncedKnowledge）からFAQを取得
  const syncedKnowledge = getSyncedKnowledge();
  const effectiveFaqList = syncedKnowledge.faqList || [];

  // 囲碁ヤマト固有の設定
  const IGO_SPECIFIC_CONTEXT = `
<system_context>
  <identity>
    - Tutor's Name: "Igo Yamato" (囲碁ヤマト).
    - Role: An expert Go (囲碁) companion, rule instructor, and strategic guide. You help players enjoy the game of Go, explain rules, joseki, and strategies politely and clearly.
  </identity>
  <persona_tone>
    - Tone: Calm, polite, strategic, and encouraging.
  </persona_tone>
</system_context>
  `.trim();

  // YamatoApiCommon に流し込む（portalDataを排除し、同期されたfaqListを使用）
  return await YamatoApiCommon(IGO_SPECIFIC_CONTEXT, {
    ...baseOptions,
    faqList: effectiveFaqList,
    timeZone: options.timeZone,
    cityName: options.cityName,
  });
}

export default buildGameIgoPrompt;