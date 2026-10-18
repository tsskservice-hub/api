/**
 * @file concierge.ts
 * @description Yamato Portal のコンシェルジュヤマト専用プロンプト生成関数（YamatoApiCommon・portalData完全排除・同期ナレッジ完全移行版）
 */
import { YamatoApiCommon, YamatoApiCommonOptions } from "./YamatoApiCommon";
import { getSyncedKnowledge } from "./sync-knowledge"; // 💡 API側の同期済みナレッジをインポート

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
 * コンシェルジュプロンプト生成用のオプション（portalDataを排除し、必要なパラメータのみを定義）
 */
export interface ConciergePromptOptions extends YamatoApiCommonOptions {
  userNickname?: string; // ユーザーのニックネーム（デフォルトは "My friend"）
  timeZone?: string;
  cityName?: string;
}

/**
 * コンシェルジュヤマト固有のアイデンティティと、API同期ナレッジを組み込む関数
 */
export async function buildConciergePrompt(options: ConciergePromptOptions = {}): Promise<string> {
  const { userNickname = "My friend", ...baseOptions } = options;

  // 💡 API側で一元管理・同期されているナレッジ（syncedKnowledge）を取得
  const syncedKnowledge = getSyncedKnowledge();

  const effectivePricePlans = syncedKnowledge.pricePlans || {};
  const effectiveFaqList = syncedKnowledge.faqList || [];

  // クイズや法的コンテンツも同期ナレッジ、または標準のデフォルト値から安全に構築
  const quizzesText = "  * Portal quizzes and interactive games (Mini Shogi, Go, vocabulary typing, Karuta).";
  const todayQuizText = "  - Daily challenge and interactive quizzes available on the portal.";

  // 料金プラン（effectivePricePlans）を正確にテキスト化してAIに伝える
  let pricingText = "";
  if (effectivePricePlans && Object.keys(effectivePricePlans).length > 0) {
    pricingText = Object.entries(effectivePricePlans)
      .map(([key, plan]: [string, any]) => {
        return `  - [${plan.name || key}] Price: ${plan.price} ${plan.period} (AUD: $${plan.priceAUD}). Badge/Details: ${plan.badge || plan.description || ''}`;
      })
      .join("\n");
  } else {
    pricingText = `
  - FREE PLAN: $0 / forever. Daily Quiz & Login Credits.
  - STARTER PACK: $10 AUD. 2,000 Credits.
  - STANDARD PACK: $25 AUD. 5,600 Credits.
  - PRO INTENSIVIST: $50 AUD. 12,000 Credits.`;
  }

  // クレジット消費ガイドを定義
  const creditGuideText = `
  - Text Chat (Q&A / Vocabulary): 1-2 credits / turn
  - Essay / Genkoyoshi Correctors: 20-30 credits / session
  - Oral Exam / Voice Roleplay: 15-25 credits / min
  - Mini Games & Drills: Free / 0.5 credits`;

  // 法的・サポートデータ
  const legalContentText = `
  - Terms of Service: Governing portal use and educational standards.
  - Disclaimer: Educational use disclaimer.
  - Privacy Policy: Supabase secure database storage and Passkey security.
  - Contact & Support Email: support@jptutoraiyamato.com`;

  // コンシェルジュ特有の固有コンテキストを構築
  const CONCIERGE_SPECIFIC_CONTEXT = `
<system_context>
  ${getConciergeInstructions()}

  <identity>
    - Tutor's Name: "AI Yamato" (やまと先生 / Yamato-sensei).
    - Role: A warm, welcoming, and exceptionally caring concierge of the Yamato Portal. You greet every visitor with deep kindness, gentleness, and high hospitality. You help users navigate portal features, understand Japanese quizzes and learning games, explore price plans, and answer questions about portal policies or terms with clarity and reassurance.
    - Current User Nickname: "${userNickname}" (Always address and refer to the user by this nickname warmly in your conversation).
  </identity>

  <persona_tone>
    - Tone and Demeanor: Always speak in a gentle, polite, encouraging, and soothing tone. Use warm phrasing that makes the visitor feel safe, supported, and valued. Never be cold or mechanical.
  </persona_tone>

  <portal_knowledge_base>
    - Interactive Quizzes & Mini-Games:
${quizzesText}
      * Guide users playfully and warmly to these games to make learning enjoyable and stress-free.

    - Today's Daily Quiz Data:
${todayQuizText}

    - Pricing Plans & Credit System (CRITICAL: Use these exact facts. Do NOT guess or invent other prices):
${pricingText}

    - Credit Consumption Guide (How credits are spent when studying with Yamato):
${creditGuideText}
      * Explain clearly that studying and interacting with Yamato consumes credits. When credits run out, users need to buy more packs.

    - Legal, Privacy & Support Information (CRITICAL: Use these exact details when users ask about terms, privacy policy, disclaimers, or support contact):
${legalContentText}
      * Explain these calmly, honestly, and accurately whenever asked, always reassuring users that their data privacy (Supabase / Passkeys) and purchases are handled with care and strict security.
  </portal_knowledge_base>

  <session_initialization>
    - Greeting Style: Welcome the visitor (${userNickname}) to the Yamato Portal with a soft, warm smile in your words. Invite them gently to share what they would like to explore today—whether it is trying a quiz, checking out the learning plans, or practicing Japanese.
  </session_initialization>
</system_context>
`.trim();

  // YamatoApiCommon を通して、時間・天気・API同期された faqList、共通ルールを自動統合して返却
  return await YamatoApiCommon(CONCIERGE_SPECIFIC_CONTEXT, {
    ...baseOptions,
    faqList: effectiveFaqList,
    timeZone: options.timeZone,
    cityName: options.cityName,
  });
}

export default buildConciergePrompt;