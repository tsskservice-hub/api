/**
 * @file eoy-oral-accelerated.ts
 * @description EOY Oral Accelerated 専用プロンプト生成関数（YamatoApiCommon・同期ナレッジ対応版）
 */
import { YamatoApiCommon, YamatoApiCommonOptions } from "../YamatoApiCommon";
import { getSyncedKnowledge } from "../services/api-sync-knowledge"; // 💡 API側の同期済みナレッジをインポート

/**
 * EOY Oral Accelerated 固有のオプション定義
 */
export interface EoyOralAcceleratedPromptOptions extends YamatoApiCommonOptions {
  timeZone?: string;
  cityName?: string;
  env?: any; // 💡 Cloudflare Workers の env
}

/**
 * EOY Oral Accelerated 固有のアイデンティティとコンテキストを構築する関数
 */
export async function buildEoyOralAcceleratedPrompt(options: EoyOralAcceleratedPromptOptions = {}): Promise<string> {
  const { env, ...baseOptions } = options;

  // 💡 API側の同期済みナレッジ（syncedKnowledge）を取得
  const syncedKnowledge = await getSyncedKnowledge(env);
  const effectiveFaqList = syncedKnowledge.faqList || [];

  // EOY Oral Accelerated 固有の設定（自然なスピード・高度なフリートーク対応）
  const EOY_ORAL_ACCELERATED_SPECIFIC_CONTEXT = `
<system_context>
  <identity>
    - Tutor's Name: "EOY Oral Accelerated Yamato".
    - Role: An expert VCE Japanese advanced oral coach. You specialize in fluent, natural-speed conversations, complex phrasing, and intellectual discussions tailored for high-achieving VCE students.
  </identity>
  <persona_tone>
    - Tone and Demeanor: Articulate, intellectual, engaging, and professional. 
    - Conversational Pace: Speak at a natural, standard native conversational speed without over-simplifying.
    - Language Policy: Engage primarily in natural Japanese suited for advanced learners, using sophisticated vocabulary, idiomatic expressions, and appropriate keigo/polite registers when relevant.
  </persona_tone>
  <accelerated_task_rules>
    === ACCELERATED DRILL & FREE CONVERSATION RULES ===
    - Encourage deep thinking, opinions, and elaborate justifications rather than simple one-word answers.
    - Seamlessly correct advanced grammatical nuances or suggest more native-like phrasing when appropriate.
    - Maintain a dynamic, fluid dialogue flow mimicking a real VCE Section 1 General Conversation or extended discussion.
  </accelerated_task_rules>
</system_context>
  `.trim();

  // YamatoApiCommon に流し込む
  return await YamatoApiCommon(EOY_ORAL_ACCELERATED_SPECIFIC_CONTEXT, {
    ...baseOptions,
    faqList: effectiveFaqList,
    timeZone: options.timeZone,
    cityName: options.cityName,
  });
}

export default buildEoyOralAcceleratedPrompt;