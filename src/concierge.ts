/**
 * @file concierge.ts
 * @description Yamato Portal コンシェルジュヤマト（Supabase データ直接検証・フォールバック対応・クイズ対応版）
 * 💡 ハードコードされたデフォルトテキストを排除し、Supabase (syncedKnowledge) に保存されたデータのみを抽出してAIプロンプトへ組み込みます。
 */
import { YamatoApiCommon, YamatoApiCommonOptions } from "./YamatoApiCommon";
import { getSyncedKnowledge } from "./api-sync-knowledge";

/**
 * LPコンシェルジュ専用の振る舞いインストラクション
 */
function getConciergeInstructions(): string {
  return `
<concierge_mode_rules>
- Role: Landing Page Concierge for Yamato Portal.
- Objective: Welcome every visitor (students, parents, and educators) warmly as "my friend". Actively listen to their needs or questions regarding Japanese learning, and guide them smoothly to the most suitable features or rooms inside the portal (such as VCE writing practice, oral exam rooms, daily cultural/language quizzes, or general grammar resources).
- Tone & Style: Highly hospitable, encouraging, warm, approachable, and helpful.
</concierge_mode_rules>`.trim();
}

/**
 * コンシェルジュプロンプト生成用のオプション構造体
 */
export interface ConciergePromptOptions extends YamatoApiCommonOptions {
  userNickname?: string;
  timeZone?: string;
  cityName?: string;
  env?: any; // Cloudflare Workers 環境変数・Supabase接続情報
}

/**
 * Supabaseからの動的ナレッジのみでプロンプトを構築する主関数
 */
export async function buildConciergePrompt(options: ConciergePromptOptions = {}): Promise<string> {
  const { userNickname = "My friend", env, ...baseOptions } = options;

  // 💡 Supabase から同期されたナレッジオブジェクトを取得
  const syncedKnowledge = await getSyncedKnowledge(env);

  const effectivePricePlans = syncedKnowledge?.pricePlans || {};
  const effectiveFaqList = syncedKnowledge?.faqList || [];
  const portalContent = syncedKnowledge?.portalContent || {};
  const quizzesData = syncedKnowledge?.quizzes || [];

  // =========================================================================
  // 1. モジュール一覧の抽出（Supabaseデータのみ）
  // =========================================================================
  let portalModulesText = "";
  if (portalContent?.modulesSection) {
    const sec1 = portalContent.modulesSection.section1;
    const sec2 = portalContent.modulesSection.section2;

    const formatModules = (sec: any) => {
      if (!sec || !sec.modules || !Array.isArray(sec.modules)) return "";
      return sec.modules.map((m: any) => {
        return `    - [${m.name}] (Category: ${m.category}, Path: ${m.path || 'N/A'}, Status: ${m.isComingSoon ? 'Coming Soon' : 'Available'})
      Description: ${m.description}`;
      }).join("\n");
    };

    portalModulesText = `
    * ${sec1?.title || 'Section 1'}:
${formatModules(sec1)}

    * ${sec2?.title || 'Section 2'}:
${formatModules(sec2)}`;
  } else {
    portalModulesText = "    * [DB ERROR] No portal modules data found in Database.";
  }

// =========================================================================
  // 2. 料金プランの抽出（階層を自動で探索してすべて取得）
  // =========================================================================
  let pricingText = "";
  
  // 💡 オブジェクト内を再帰的に探索し、プランらしいデータ（nameやpriceを持つオブジェクト）を全て見つけ出す関数
  const extractPlans = (obj: any): any[] => {
    if (!obj || typeof obj !== 'object') return [];
    let results: any[] = [];
    
    for (const [key, val] of Object.entries(obj)) {
      // 除外すべき特殊キー
      if (key === 'CREDIT_CONSUMPTION_GUIDE' || key === 'campaignNotice' || key === 'creditConsumptionGuide') continue;
      
      if (val && typeof val === 'object') {
        // プランの目印となるプロパティ（nameやpriceなど）を持っているか判定
        if ('name' in val || 'price' in val || 'regularCredits' in val) {
          results.push(val);
        } else {
          // まだ階層が深ければ、さらに奥へ潜って探索する
          results = results.concat(extractPlans(val));
        }
      }
    }
    return results;
  };

  const extractedPlans = extractPlans(effectivePricePlans);
  if (extractedPlans.length > 0) {
    pricingText = extractedPlans
      .map((plan: any) => {
        return `  - [${plan.name || plan.title}] Price: ${plan.price || 'Free'} ${plan.period || ''} (AUD: $${plan.priceAUD || ''}). Details: ${plan.badge || plan.description || ''}`;
      })
      .join("\n");
  }

  if (!pricingText) {
    pricingText = "  - [DB ERROR] No price plans data found in Database.";
  }


  // =========================================================================
  // 3. クレジット消費ガイド (CREDIT_CONSUMPTION_GUIDE) の抽出（Supabaseデータのみ）
  // =========================================================================
  const rawCreditGuide = 
    syncedKnowledge?.creditGuide || 
    effectivePricePlans?.CREDIT_CONSUMPTION_GUIDE || 
    null;

  let creditGuideText = "";
  if (Array.isArray(rawCreditGuide) && rawCreditGuide.length > 0) {
    creditGuideText = rawCreditGuide
      .map((g: any) => `  - ${g.item}: ${g.cost}`)
      .join("\n");
  } else {
    creditGuideText = "  - [DB ERROR] No CREDIT_CONSUMPTION_GUIDE found in Database.";
  }

  // =========================================================================
  // 4. デイリークイズ (DAILY_QUZZES / Quizzes) の抽出（Supabaseデータのみ）
  // =========================================================================
  let quizzesText = "";
  if (Array.isArray(quizzesData) && quizzesData.length > 0) {
    // クイズの総数やトピックの傾向をAIに伝える
    const totalCount = quizzesData.length;
    const sampleTopics = Array.from(new Set(quizzesData.map((q: any) => q.topic))).slice(0, 10).join(", ");
    
    quizzesText = `
  - Total Daily Quizzes Available: ${totalCount} items across diverse topics.
  - Topics include: ${sampleTopics}, and more!
  - Purpose: Designed to test Japanese cultural, historical, food, anime, and linguistic knowledge while allowing learners to earn daily login and correct-answer credits.`;
  } else {
    quizzesText = "  - [DB ERROR] No daily quizzes data found in Database.";
  }

  // =========================================================================
  // 5. 法的・サポートデータの抽出（Supabaseデータのみ）
  // =========================================================================
  let legalContentText = "";
  if (syncedKnowledge?.legalContent && Object.keys(syncedKnowledge.legalContent).length > 0) {
    const lc = syncedKnowledge.legalContent;
    legalContentText = `
  - Terms of Service: ${lc.terms?.summary || 'N/A'}
  - Disclaimer: ${lc.disclaimer?.summary || 'N/A'}
  - Privacy Policy: ${lc.privacy?.summary || 'N/A'}
  - Contact Email: ${lc.contact?.directEmail || 'N/A'}`;
  } else {
    legalContentText = "  - [DB ERROR] No legal content data found in Database.";
  }

  // 💡 プロンプト構造の組み立て
  const CONCIERGE_SPECIFIC_CONTEXT = `
<system_context>
  ${getConciergeInstructions()}

  <identity>
    - Tutor's Name: "AI Yamato" (やまと先生 / Yamato-sensei).
    - Role: Landing Page Concierge for Yamato Portal.
    - Current User Nickname: "${userNickname}" (Address the user warmly by this name).
  </identity>

  <persona_tone>
    - Tone and Demeanor: Always gentle, polite, encouraging, and highly hospitable.
  </persona_tone>

  <portal_knowledge_base>
    - Portal Pages & Learning Modules (STRICTLY FROM DATABASE):
${portalModulesText}

    - Daily Quizzes & Cultural Learning (STRICTLY FROM DATABASE):
${quizzesText}

    - Pricing Plans & Credit System (STRICTLY FROM DATABASE):
${pricingText}

    - Credit Consumption Guide & Rules (STRICTLY FROM DATABASE):
${creditGuideText}

    - Legal, Privacy, Account & Support Information (STRICTLY FROM DATABASE):
${legalContentText}
  </portal_knowledge_base>

  <session_initialization>
    - Greeting Style: Welcome the visitor (${userNickname}) warmly to the Yamato Portal and introduce features including our daily quizzes and learning rooms.
  </session_initialization>
</system_context>
`.trim();

  // YamatoApiCommon を通じて faqList や基礎ルールの統合を行い返却
  return await YamatoApiCommon(CONCIERGE_SPECIFIC_CONTEXT, {
    ...baseOptions,
    faqList: effectiveFaqList,
    timeZone: options.timeZone,
    cityName: options.cityName,
  });
}

export default buildConciergePrompt;