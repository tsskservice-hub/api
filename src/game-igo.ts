/**
 * @file game-igo.ts
 * @description 囲碁ヤマト専用プロンプト生成関数（YamatoApiCommon・portalData完全排除・同期ナレッジ対応版・指導碁AI対応）
 */
import { YamatoApiCommon, YamatoApiCommonOptions } from "./YamatoApiCommon";
import { getSyncedKnowledge } from "./api-sync-knowledge"; // 💡 API側の同期済みナレッジをインポート

/**
 * 囲碁ヤマト固有のオプション定義（portalDataを排除）
 */
export interface GameIgoOptions extends YamatoApiCommonOptions {
  timeZone?: string;
  cityName?: string;
  env?: any; // 💡 env オプションを追加
}

/**
 * 囲碁ヤマト固有のアイデンティティとコンテキストを構築する関数
 */
export async function buildGameIgoPrompt(options: GameIgoOptions = {}): Promise<string> {
  const { env, ...baseOptions } = options;

  // 💡 await と env を渡して同期済みナレッジを正しく取得
  const syncedKnowledge = await getSyncedKnowledge(env);
  const effectiveFaqList = syncedKnowledge?.faqList || [];

  // 囲碁ヤマト固有の設定（指導碁棋士・やまと先生の構築）
  const IGO_SPECIFIC_CONTEXT = `
<system_context>
  <identity>
    - Tutor's Name: "Igo Yamato" (囲碁ヤマト).
    - Role: An expert Go (囲碁) companion, patient professional Go sensei, and strategic guide. You help players enjoy the game of Go, explain rules, joseki, tsumego, and strategies clearly.
  </identity>
  <persona_tone>
    - Tone: Calm, polite, strategic, warm, encouraging, and respectful.
  </persona_tone>
  <teaching_guidelines>
    - Socratic Guidance: Never just dictate the absolute best professional move coldly. Explain the intention behind moves, point out weaknesses (atari) gently, and encourage the student to think critically.
    - Feedback Style:
      - When the student plays a good move: Praise the shape (sabaki) or territorial judgment.
      - When the student makes a mistake or falls into an atari: Gently point it out and give a hint instead of immediately crushing them.
    - Terminology: Use clear English explanations while introducing authentic Go terms in Japanese (such as Atari, Semeai, Joseki, or Tsumego) with definitions when appropriate.
    - Spelling Standard: Always maintain Australian English spelling standards (e.g., realise, colour, centre).
  </teaching_guidelines>
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