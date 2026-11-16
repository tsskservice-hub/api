/**
 * @file eoy-oral-drill.ts
 * @description EOY Oral Drill ヤマト専用プロンプト生成関数（YamatoApiCommon・portalData完全排除・同期ナレッジ対応版）
 */
import { YamatoApiCommon, YamatoApiCommonOptions } from "../YamatoApiCommon";
import { getSyncedKnowledge } from "../services/api-sync-knowledge"; // 💡 API側の同期済みナレッジをインポート
import { buildOralTurnContext } from "./oral-turn-context";

/**
 * 口頭試験用のペース別トーン調整
 */
function getOralPaceInstruction(pace?: string): string {
  if (!pace) return "";

  const lowerPace = pace.toLowerCase();

  if (lowerPace.includes("accelerated")) {
    return `
<oral_pace_accelerated>
- Target Student: High achievers and VCE high-scorers.
- Tone & Persona: Rigorous, articulate, and intellectual. Use sophisticated VCE vocabulary and linguistic terminology.
</oral_pace_accelerated>`.trim();
  }

  if (lowerPace.includes("normal")) {
    return `
<oral_pace_normal>
- Target Student: Average VCE Japanese learners.
- Tone & Persona: Balanced, clear, and standard tutor persona using well-structured English.
</oral_pace_normal>`.trim();
  }

  return `
<oral_pace_steady>
- Target Student: Beginners or struggling students.
- Tone & Persona: Warm, extremely encouraging, friendly, and patient. Use very simple English and short sentences. Heavy emojis (🌟, 💖, 😊, ✨, 💪, 🎉).
</oral_pace_steady>`.trim();
}

/**
 * EOY Oral Drill 固有のオプション定義（portalDataを排除）
 */
export interface EoyOralDrillPromptOptions extends YamatoApiCommonOptions {
  /** ペースや難易度の調整用（"accelerated", "normal", "steady" など） */
  pace?: string;
  /** 今ドリルで出している質問（画面から。タグは除去済み） */
  expectedQuestion?: string;
  /** その質問に対して生徒が登録した答え（画面から。タグは除去済み） */
  registeredAnswer?: string;
  timeZone?: string;
  cityName?: string;
  env?: any; // 💡 追加: Cloudflare Workers の env
}

/**
 * EOY Oral Drill 固有のアイデンティティとコンテキストを構築する関数
 */
export async function buildEoyOralDrillPrompt(options: EoyOralDrillPromptOptions = {}): Promise<string> {
  const { pace, env, expectedQuestion, registeredAnswer, ...baseOptions } = options; // 💡 envを受け取る

  // 💡 API側の同期済みナレッジ（syncedKnowledge）を await と env を指定して取得
  const syncedKnowledge = await getSyncedKnowledge(env);
  const effectiveFaqList = syncedKnowledge.faqList || [];

  // ペースに応じた指示を取得
  const paceInstruction = getOralPaceInstruction(pace);

  // 今の質問と登録した答え（あるときだけ）
  const drillTurnContext = buildOralTurnContext("drill", expectedQuestion, registeredAnswer);

  // EOY Oral Drill 固有の設定
  const EOY_ORAL_DRILL_SPECIFIC_CONTEXT = `
<system_context>
  <identity>
    - Tutor's Name: "EOY Oral Drill Yamato" (EOY口頭試験ドリルヤマト).
    - Role: An expert VCE Japanese oral practice coach specializing in rapid-fire conversational drills, pronunciation patterns, and foundational phrasing for Section 1 General Conversation. You help students build fluency, confidence, and quick response reflexes in Japanese.
  </identity>
  <persona_tone>
    - Tone and Demeanor: Energetic, encouraging, brisk, and highly interactive.
  </persona_tone>
  ${paceInstruction}
  ${drillTurnContext}
</system_context>
  `.trim();

  // YamatoApiCommon に流し込む（portalDataを排除し、同期されたfaqListを使用）
  return await YamatoApiCommon(EOY_ORAL_DRILL_SPECIFIC_CONTEXT, {
    ...baseOptions,
    faqList: effectiveFaqList,
    timeZone: options.timeZone,
    cityName: options.cityName,
  });
}

export default buildEoyOralDrillPrompt;