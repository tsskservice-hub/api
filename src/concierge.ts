/**
 * @file concierge.ts
 * @description Yamato Portal のコンシェルジュヤマト専用プロンプト生成関数（価格データ・本日のクイズ対応版）
 */
import { buildBaseSystemPrompt, SystemPromptOptions } from "./base-rules";
import { getFormattedTimeForZone } from "./time-utils";
import { getCityWeatherContext } from "./weather-utils";

/**
 * フロントエンド（yamato-portal）から動的に渡されるポータルデータの型定義
 */
export interface PortalContextData {
  quizzes?: Array<{ title: string; description: string }>;
  todayQuiz?: {
    id: string;
    topic: string;
    date: string;
    question: string;
    options: string[];
    answer: number;
    explanation: string;
  };
  pricePlans?: Record<string, any>; // price-plans.ts の PRICE_PLANS を受け取る
  creditGuide?: Array<{ item: string; cost: string }>; // クレジット消費ガイドを受け取る
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
export async function buildConciergePrompt(options: ConciergePromptOptions = {}): Promise<string> {
  const { portalData = {}, ...baseOptions } = options;

  // タイムゾーンと時間の取得
  const timeZone = portalData.timeZone || "Australia/Melbourne";
  const timeContext = getFormattedTimeForZone(timeZone);

  // 天気情報の取得
  let weatherContext = "Fine, 20°C";
  try {
    const weather = await getCityWeatherContext(portalData.cityName || "Melbourne");
    weatherContext = weather ? String(weather) : "Fine, 20°C";
  } catch (e: any) {
    console.warn("⚠️ [concierge.ts] 天気情報の取得に失敗しました:", e.message);
  }

  // 動的に渡されたクイズ情報をテキストに変換
  const quizzesText =
    portalData.quizzes && portalData.quizzes.length > 0
      ? portalData.quizzes.map((q) => `  * ${q.title}: ${q.description}`).join("\n")
      : "  * Portal quizzes and interactive games (Mini Shogi, Go, vocabulary typing, Karuta).";

  // ★ 本日のクイズ（todayQuiz）を正確にテキスト化してAIに伝える
  let todayQuizText = "";
  if (portalData.todayQuiz) {
    const q = portalData.todayQuiz;
    const correctAnswerText = q.options[q.answer] || "";
    todayQuizText = `
  - TODAY'S DAILY QUIZ (CRITICAL FACTUAL DATA: Use this exact information when users ask about today's quiz, question, options, or correct answer):
    * Topic: ${q.topic} (Date: ${q.date})
    * Question: "${q.question}"
    * Options: ${q.options.map((opt, idx) => `(${idx})${opt}`).join(", ")}
    * Correct Answer Index: ${q.answer} (${correctAnswerText})
    * Explanation: "${q.explanation}"
      * Guide users warmly through this quiz, encourage them to choose the right option, and explain the cultural background gently using the explanation provided.`;
  } else {
    todayQuizText = "  - No specific active quiz loaded for today.";
  }

  // ★ 料金プラン（PRICE_PLANS）を正確にテキスト化してAIに伝える
  let pricingText = "";
  if (portalData.pricePlans) {
    pricingText = Object.entries(portalData.pricePlans)
      .map(([key, plan]: [string, any]) => {
        return `  - [${plan.name}] Price: ${plan.price} ${plan.period} (AUD: $${plan.priceAUD}). Badge/Details: ${plan.badge || plan.description}`;
      })
      .join("\n");
  } else {
    pricingText = `
  - FREE PLAN: $0 / forever. Daily Quiz & Login Credits (4 credits, valid for 7 days).
  - STARTER PACK: $10 AUD. 2,000 Credits (1,000 unexpired + 1,000 bonus valid until Oct 29). Ideal for beginners.
  - STANDARD PACK: $25 AUD. 5,600 Credits (2,800 unexpired + 2,800 bonus valid until Oct 29). Our most popular choice.
  - PRO INTENSIVIST: $50 AUD. 12,000 Credits (6,000 unexpired + 6,000 bonus valid until Oct 29). For heavy users.`;
  }

  // ★ クレジット消費ガイドをテキスト化
  let creditGuideText = "";
  if (portalData.creditGuide && portalData.creditGuide.length > 0) {
    creditGuideText = portalData.creditGuide
      .map((g) => `  - ${g.item}: ${g.cost}`)
      .join("\n");
  } else {
    creditGuideText = `
  - Text Chat (Q&A / Vocabulary): 1-2 credits / turn
  - Essay / Genkoyoshi Correctors: 20-30 credits / session
  - Oral Exam / Voice Roleplay: 15-25 credits / min
  - Mini Games & Drills: Free / 0.5 credits`;
  }

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
    - Interactive Quizzes & Mini-Games:
${quizzesText}
      * Guide users playfully and warmly to these games to make learning enjoyable and stress-free.

    - Today's Daily Quiz Data (CRITICAL: Use these exact questions, options, and correct answers when asked about today's quiz):
${todayQuizText}

    - Pricing Plans & Credit System (CRITICAL: Use these exact facts. Do NOT guess or invent other prices like US$5):
${pricingText}

    - Credit Consumption Guide (How credits are spent when studying with Yamato):
${creditGuideText}
      * Explain clearly that studying and interacting with Yamato consumes credits. When credits run out, users need to buy more packs.

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