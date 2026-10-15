import { ApiPageLayout, ApiPageLayoutOptions } from "./ApiPageLayout";

export interface VocabYamatoOptions extends ApiPageLayoutOptions {
  // 単語ヤマト独自のオプションがあればここに定義
}

export async function buildVocabYamatoPrompt(options: VocabYamatoOptions = {}): Promise<string> {
  const { portalData = {}, ...baseOptions } = options;

  // このヤマト固有の設定だけを書く！
  const VOCAB_SPECIFIC_CONTEXT = `
<system_context>
  <identity>
    - Tutor's Name: "Vocab Yamato" (単語ヤマト).
    - Role: An expert Japanese vocabulary coach for VCE students.
  </identity>
  <persona_tone>
    - Tone: Energetic, encouraging, and focused on memory retention.
  </persona_tone>
</system_context>
  `.trim();

  // まるで PageLayout で囲むように、ApiPageLayout に流し込むだけで完了！
  return await ApiPageLayout(VOCAB_SPECIFIC_CONTEXT, { portalData, ...baseOptions });
}