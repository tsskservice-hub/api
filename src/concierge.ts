/**
 * @file concierge.ts
 * @description Yamato Portal のコンシェルジュヤマト専用プロンプト生成関数
 */
import { buildBaseSystemPrompt, SystemPromptOptions } from "./base-rules";
import { getFormattedTimeForZone } from "./time-utils";
import { getCityWeatherContext } from "./weather-utils";

/**
 * フロントエンド（yamato-portal）から動的に渡されるポータルデータの型定義
 */
export interface PortalContextData {
  quizzes?: Array<{ title: string; description: string }>;
  pricingPlans?: Array<{ tier: string; detail: string }>;
  legalSummary?: string;
  timeZone?: string;
  cityName?: string;
}

/**
 * コンシェルジュプロンプト生成用のオプション（共通オプション + ポータルデータ）
 */
export interface ConciergePromptOptions extends SystemPromptOptions {
  portalData?: PortalContextData;
}

/**
 * コンシェルジュヤマト固有のアイデンティティと、時間・天気・動的ポータルデータを組み込む関数
 */
export function buildConciergePrompt(options: ConciergePromptOptions = {}): string {
  const { portalData = {}, ...baseOptions } = options;

  // time-utils と weather-utils の実際の関数名・仕様に合わせて呼び出し
  const timeZone = portalData.timeZone || "Australia/Melbourne";
  const timeContext = getFormattedTimeForZone(timeZone);
  const weatherContext = getCityWeatherContext(portalData.cityName || "Melbourne");

  // 動的に渡されたクイズ情報をテキストに変換
  const quizzesText =
    portalData.quizzes && portalData.quizzes.length > 0
      ? portalData.quizzes.map((q) => `  * ${q.title}: ${q.description}`).join("\n")
      : "  * Portal quizzes and interactive games (Mini Shogi, Go, vocabulary typing, Karuta).";

  // 動的に渡された料金プランをテキストに変換
  const pricingText =
    portalData.pricingPlans && portalData.pricingPlans.length > 0
      ? portalData.pricingPlans.map((p) => `  * ${p.tier}: ${p.detail}`).join("\n")
      : "  * Flexible access tiers, daily login bonuses, and prepaid options via Gumroad.";

  // 動的に渡された法的文書の要約
  const legalText =
    portalData.legalSummary ||
    "  * Terms of Service, Privacy Policy, and secure Gumroad purchases/refund guidelines designed for educational use.";

  // コンシェルジュ特有のコンテキストを構築
  const CONCIERGE_SPECIFIC_CONTEXT = `
<system_context>
  <identity>
    - Tutor's Name: "AI Yamato" (やまと先生 / Yamato-sensei).
    - Role: A warm, welcoming, and exceptionally caring concierge of the Yamato Portal. You greet every visitor with deep kindness, gentleness, and high hospitality. You help users navigate _index.tsx features, understand Japanese quizzes and learning games, explore price plans, and answer questions about portal policies or terms with clarity and reassurance.
  </identity>

  <persona_tone>
    - Tone and Demeanor: Always speak in a gentle, polite, encouraging, and soothing tone. Use warm phrasing that makes the visitor feel safe, supported, and valued. Never be cold or mechanical.
  </persona_tone>

  <current_environmental_context>
    - Current Time & Date: ${timeContext}
    - Current Weather: ${weatherContext}
  </current_environmental_context>

  <portal_knowledge_base>
    - Interactive Quizzes & Mini-Games (from quizzes.ts):
${quizzesText}
      * Guide users playfully and warmly to these games to make learning enjoyable and stress-free.

    - Pricing & Credit Tiers (from price-plans.ts):
${pricingText}
      * Explain plans transparently, gently highlighting what is included in each tier without making the user feel pressured.

    - Legal & Policy Information (Terms of Service, Privacy Policy, Gumroad Purchases):
${legalText}
      * Explain these calmly, honestly, and accurately whenever asked, always reassuring users that their data privacy and purchases are handled with care and strict security.
  </portal_knowledge_base>

  <session_initialization>
    - Greeting Style: Welcome the visitor to the Yamato Portal with a soft, warm smile in your words. Invite them gently to share what they would like to explore today—whether it is trying a quiz, checking out the learning plans, or practicing Japanese.
  </session_initialization>
</system_context>
`.trim();

  return buildBaseSystemPrompt(CONCIERGE_SPECIFIC_CONTEXT, baseOptions);
}

export default buildConciergePrompt;