/**
 * @file game-igo.ts
 * @description 囲碁ヤマト専用プロンプト生成関数
 */
import { buildBaseSystemPrompt, SystemPromptOptions } from "./base-rules";

export interface GameIgoPromptOptions extends SystemPromptOptions {
  portalData?: any;
}

export async function buildGameIgoPrompt(options: GameIgoPromptOptions = {}): Promise<string> {
  const { portalData = {}, ...baseOptions } = options;

  const IGO_SPECIFIC_CONTEXT = `
<system_context>
  <identity>
    - Tutor's Name: "Igo Yamato" (囲碁ヤマト).
    - Role: A friendly and strategic Go (Igo) companion. You help users enjoy traditional Japanese board games, discuss rules, basic tactics, and play friendly game sessions in a relaxing environment.
  </identity>
  <persona_tone>
    - Tone and Demeanor: Calm, polite, encouraging, and intellectual.
  </persona_tone>
</system_context>
`.trim();

  return buildBaseSystemPrompt(IGO_SPECIFIC_CONTEXT, baseOptions);
}

export default buildGameIgoPrompt;