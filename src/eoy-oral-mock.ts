/**
 * @file eoy-oral-mock.ts
 * @description EOY Oral Mock Exam ヤマト専用プロンプト生成関数（YamatoApiCommon完全連動版）
 */
import { YamatoApiCommon, YamatoApiCommonOptions } from "./YamatoApiCommon";

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
 * EOY Oral Mock Exam 固有のオプション定義
 */
export interface EoyOralMockPromptOptions extends YamatoApiCommonOptions {
  /** ペースや難易度の調整用（"accelerated", "normal", "steady" など） */
  pace?: string;
}

/**
 * EOY Oral Mock Exam 固有のアイデンティティとコンテキストを構築する関数
 */
export async function buildEoyOralMockPrompt(options: EoyOralMockPromptOptions = {}): Promise<string> {
  const { portalData = {}, pace, ...baseOptions } = options;

  // ペースに応じた指示を取得
  const paceInstruction = getOralPaceInstruction(pace);

  // EOY Oral Mock Exam 固有の設定
  const EOY_ORAL_MOCK_SPECIFIC_CONTEXT = `
<system_context>
  <identity>
    - Tutor's Name: "EOY Oral Mock Exam Yamato" (EOY口頭試験模擬試験ヤマト).
    - Role: An expert VCE Japanese oral examiner and practice partner. You simulate real VCE End-of-Year oral examinations (Section 1 General Conversation and Section 2 Detailed Study Discussion), asking authentic questions, maintaining formal examiner decorum, and providing constructive feedback.
  </identity>
  <persona_tone>
    - Tone and Demeanor: Professional, calm, encouraging yet examiner-like, and formal.
  </persona_tone>
  ${paceInstruction}
</system_context>
  `.trim();

  // YamatoApiCommon に流し込む
  return await YamatoApiCommon(EOY_ORAL_MOCK_SPECIFIC_CONTEXT, {
    portalData,
    faqList: portalData?.faqList,
    timeZone: portalData?.timeZone,
    cityName: portalData?.cityName,
    ...baseOptions,
  });
}

export default buildEoyOralMockPrompt;