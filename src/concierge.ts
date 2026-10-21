/**
 * @file concierge.ts
 * @description Yamato Portal のコンシェルジュヤマト専用プロンプト生成関数（Cloudflare KV 同期ナレッジ対応版）
 */
import { YamatoApiCommon, YamatoApiCommonOptions } from "./YamatoApiCommon";
import { getSyncedKnowledge } from "./api-sync-knowledge"; // 💡 API側のKV同期ナレッジ取得関数をインポート

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
 * コンシェルジュプロンプト生成用のオプション（env を追加定義）
 */
export interface ConciergePromptOptions extends YamatoApiCommonOptions {
  userNickname?: string; // ユーザーのニックネーム（デフォルトは "My friend"）
  timeZone?: string;
  cityName?: string;
  env?: any; // 💡 Cloudflare Workers の環境変数・KVバインド (YAMATO_KNOWLEDGE)
}

/**
 * コンシェルジュヤマト固有のアイデンティティと、Cloudflare KV同期ナレッジを組み込む関数
 */
export async function buildConciergePrompt(options: ConciergePromptOptions = {}): Promise<string> {
  const { userNickname = "My friend", env, ...baseOptions } = options;

  // 💡 Cloudflare KV から一元管理・同期されているナレッジを非同期で取得
  const syncedKnowledge = await getSyncedKnowledge(env);

  const effectivePricePlans = syncedKnowledge.pricePlans || {};
  const effectiveFaqList = syncedKnowledge.faqList || [];
  const portalContent = syncedKnowledge.portalContent || {}; // ポータル全体仕様・LP・モジュールデータ

  // ポータルのモジュール一覧（Section 1 & Section 2）をテキスト化してAIに伝える
  let portalModulesText = "";
  if (portalContent.modulesSection) {
    const sec1 = portalContent.modulesSection.section1;
    const sec2 = portalContent.modulesSection.section2;

    const formatModules = (sec: any) => {
      if (!sec || !sec.modules) return "";
      return sec.modules.map((m: any) => {
        return `    - [${m.name}] (Category: ${m.category}, Path: ${m.path || 'N/A'}, Status: ${m.isComingSoon ? 'Coming Soon' : 'Available'})
      Description: ${m.description}`;
      }).join("\n");
    };

    portalModulesText = `
    * ${sec1?.title || 'Section 1'}:
${formatModules(sec1)}

    * ${sec2?.title || 'Section 2'}:
${formatModules(sec2)}
    `;
  } else {
    portalModulesText = "    * General and VCE modules are available on the portal dashboard.";
  }

  // クイズや法的コンテンツのテキスト化
  const quizzesText = "  * Portal quizzes and interactive games (Mini Shogi, Go, vocabulary typing, Karuta).";
  const todayQuizText = "  - Daily challenge and interactive quizzes available on the portal (+2 credits, valid for 7 days).";

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
  - Text Chat with Yamato-sensei: 2 credits / message (Requires login)
  - Genkoyoshi Editor (General / VCE): Max 4 credits
  - EOY Writing Exam Tutor / Custom Writing: Max 2 credits
  - Daily Challenge Quiz: Free (Rewards +2 credits upon correct answer, valid for 7 days)`;

  // 法的・サポートデータ
  const legalContentText = `
  - Terms of Service & Privacy Policy: Available on portal footer. Supabase secure database storage and Passkey authentication are used.
  - Account Deletion: Can be managed via Account Settings / Profile page.
  - Support Contact: support@jptutoraiyamato.com`;

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
    - Portal Pages & Learning Modules (CRITICAL: Use these exact module names, paths, and statuses when guiding users):
${portalModulesText}

    - Interactive Quizzes & Mini-Games:
${quizzesText}

    - Today's Daily Quiz Data:
${todayQuizText}

    - Pricing Plans & Credit System (CRITICAL: Use these exact facts. Do NOT guess or invent other prices):
${pricingText}

    - Credit Consumption Guide & Rules:
${creditGuideText}

    - Legal, Privacy, Account & Support Information:
${legalContentText}
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