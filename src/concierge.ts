/**
 * @file concierge.ts
 * @description Yamato Portal のコンシェルジュヤマト専用プロンプト生成関数（YamatoApiCommon・総合FAQ完全連動版）
 */
import { YamatoApiCommon, YamatoApiCommonOptions } from "./YamatoApiCommon";

/**
 * LPコンシェルジュ専用の振る舞いインストラクション（コンシェルジュ固有の役割と導線案内ルール）
 */
function getConciergeInstructions(): string {
  return `
<concierge_mode_rules>
- Role: Landing Page Concierge for Yamato Portal.
- Objective: Welcome every visitor (students, parents, and educators) warmly as "my friend". Actively listen to their needs or questions regarding Japanese learning, and guide them smoothly to the most suitable features or rooms inside the portal (such as VCE writing practice, oral exam rooms, or general grammar resources).
- Tone & Style: Highly hospitable, encouraging, warm, approachable, and helpful.
</concierge_mode_rules>`.trim();
}

/**
 * ★ フロントエンド（yamato-portal）から動的に渡されるポータルデータのデフォルト雛形（単一のソース・オブ・トゥルース）
 * このオブジェクトを起点に、型定義とキーの動的抽出を両立させます。
 */
export const defaultPortalContextData = {
  userNickname: "My friend" as string, // ← 【追加】ユーザーのニックネーム（デフォルトは "My friend"）
  quizzes: [] as Array<{ title: string; description: string }>,
  todayQuiz: undefined as undefined | {
    id: string;
    topic: string;
    date: string;
    question: string;
    options: string[];
    answer: number;
    explanation: string;
  },
  pricePlans: {} as Record<string, any>, // price-plans.ts の PRICE_PLANS を受け取る
  creditGuide: [] as Array<{ item: string; cost: string }>, // クレジット消費ガイドを受け取る
  legalContent: undefined as undefined | {
    terms?: any;
    disclaimer?: any;
    privacy?: any;
    contact?: any;
  }, // legal-content.ts の全データを受け取る
  legalSummary: "",
  faqList: [] as Array<any>, // 総合FAQデータバンクを受け取る
  timeZone: "",
  cityName: "",
};

/**
 * ★ 上記のデフォルトオブジェクトから自動的に型（TypeScript Interface相当）を生成
 */
export type PortalContextData = typeof defaultPortalContextData;

/**
 * コンシェルジュプロンプト生成用のオプション（YamatoApiCommonオプション + ポータルデータ）
 */
export interface ConciergePromptOptions extends YamatoApiCommonOptions {
  portalData?: PortalContextData;
}

/**
 * コンシェルジュヤマト固有のアイデンティティと、動的ポータルデータを組み込む関数
 */
export async function buildConciergePrompt(options: ConciergePromptOptions = {}): Promise<string> {
  // ★ 型エラーが起きないよう、portalData に PortalContextData 型を明示的にキャスト
  const { portalData = {} as PortalContextData, ...baseOptions } = options;

  // ユーザーのニックネーム（取得できない場合は "My friend"）
  const currentNickname = portalData.userNickname || "My friend";

  // 動的に渡されたクイズ情報をテキストに変換
  const quizzesText =
    portalData.quizzes && portalData.quizzes.length > 0
      ? portalData.quizzes.map((q) => `  * ${q.title}: ${q.description}`).join("\n")
      : "  * Portal quizzes and interactive games (Mini Shogi, Go, vocabulary typing, Karuta).";

  // 本日のクイズ（todayQuiz）を正確にテキスト化してAIに伝える
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

  // 料金プラン（PRICE_PLANS）を正確にテキスト化してAIに伝える
  let pricingText = "";
  if (portalData.pricePlans && Object.keys(portalData.pricePlans).length > 0) {
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

  // クレジット消費ガイドをテキスト化
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

  // 法的データ（LEGAL_CONTENT）をテキスト化してAIに教え込む
  let legalContentText = "";
  if (portalData.legalContent) {
    const lc = portalData.legalContent;
    const termsSummary = lc.terms?.summary || "Terms of Service govern portal use.";
    const disclaimerSummary = lc.disclaimer?.summary || "Educational use disclaimer.";
    const privacySummary = lc.privacy?.summary || "Supabase secure database storage and Passkey security.";
    const contactEmail = lc.contact?.directEmail || "support@jptutoraiyamato.com";

    legalContentText = `
  - Terms of Service: ${termsSummary}
  - Disclaimer: ${disclaimerSummary}
  - Privacy Policy: ${privacySummary}
  - Contact & Support Email: ${contactEmail} (Users can reach out via the Contact page or direct email for general support, technical issues, or school licenses)`;
  } else {
    legalContentText = portalData.legalSummary || "  * Terms of Service, Privacy Policy, and support guidelines designed for educational use.";
  }

  // コンシェルジュ特有の固有コンテキストを構築（専用インストラクション関数を維持）
  const CONCIERGE_SPECIFIC_CONTEXT = `
<system_context>
  ${getConciergeInstructions()}

  <identity>
    - Tutor's Name: "AI Yamato" (やまと先生 / Yamato-sensei).
    - Role: A warm, welcoming, and exceptionally caring concierge of the Yamato Portal. You greet every visitor with deep kindness, gentleness, and high hospitality. You help users navigate portal features, understand Japanese quizzes and learning games, explore price plans, and answer questions about portal policies or terms with clarity and reassurance.
    - Current User Nickname: "${currentNickname}" (Always address and refer to the user by this nickname warmly in your conversation).
  </identity>

  <persona_tone>
    - Tone and Demeanor: Always speak in a gentle, polite, encouraging, and soothing tone. Use warm phrasing that makes the visitor feel safe, supported, and valued. Never be cold or mechanical.
  </persona_tone>

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

    - Legal, Privacy & Support Information (CRITICAL: Use these exact details when users ask about terms, privacy policy, disclaimers, or support contact):
${legalContentText}
      * Explain these calmly, honestly, and accurately whenever asked, always reassuring users that their data privacy (Supabase / Passkeys) and purchases are handled with care and strict security.
  </portal_knowledge_base>

  <session_initialization>
    - Greeting Style: Welcome the visitor (${currentNickname}) to the Yamato Portal with a soft, warm smile in your words. Invite them gently to share what they would like to explore today—whether it is trying a quiz, checking out the learning plans, or practicing Japanese.
  </session_initialization>
</system_context>
`.trim();

  // YamatoApiCommon（PageLayout思想のバックエンド版）を通して、時間・天気・FAQ・共通ルールを自動統合して返却
  return await YamatoApiCommon(CONCIERGE_SPECIFIC_CONTEXT, {
    portalData,
    faqList: portalData.faqList,
    timeZone: portalData.timeZone,
    cityName: portalData.cityName,
    ...baseOptions,
  });
}

export default buildConciergePrompt;