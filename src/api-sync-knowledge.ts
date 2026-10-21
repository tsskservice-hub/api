/**
 * @file api-sync-knowledge.ts
 * @description yamato-portal から同期される教育データ・ナレッジを Cloudflare KV を使って保持・管理するモジュール
 */

// フォールバック用の空ナレッジ構造
const DEFAULT_KNOWLEDGE = {
  faqList: [],
  legalContent: {},
  pricePlans: {},
  quizzes: {},
  portalContent: {},
  vceResources: {
    kanjiList: [],
    vceVocabularyList: [],
    oralExamQuestions: [],
    writingExamQuestions: [],
    textTypes: {},
    grammarList: {},
    writingStyles: {},
  },
  vceCriteria: {},
  lastSyncedAt: null,
};

/**
 * yamato-portal から送られたデータを Cloudflare KV (YAMATO_KNOWLEDGE) に保存する
 */
export async function setSyncedKnowledge(data: any, env: any) {
  if (!env || !env.YAMATO_KNOWLEDGE) {
    throw new Error("⚠️ [api-sync-knowledge] YAMATO_KNOWLEDGE KV binding is missing in wrangler.toml!");
  }

  const payload = {
    ...data,
    lastSyncedAt: new Date().toISOString(),
  };

  // Cloudflare KV に JSON 文字列として永続保存 ("LATEST_KNOWLEDGE" というキーを使用)
  await env.YAMATO_KNOWLEDGE.put("LATEST_KNOWLEDGE", JSON.stringify(payload));
  
  console.log("📦 [api-sync-knowledge] Knowledge base synchronized and saved to KV successfully at:", payload.lastSyncedAt);
}

/**
 * プロンプト組み立て時に Cloudflare KV から最新のナレッジを非同期で取得する
 */
export async function getSyncedKnowledge(env: any) {
  if (!env || !env.YAMATO_KNOWLEDGE) {
    console.warn("⚠️ [api-sync-knowledge] YAMATO_KNOWLEDGE KV binding is missing. Returning default knowledge.");
    return DEFAULT_KNOWLEDGE;
  }

  try {
    const dataStr = await env.YAMATO_KNOWLEDGE.get("LATEST_KNOWLEDGE");
    if (!dataStr) {
      console.warn("⚠️ [api-sync-knowledge] No knowledge found in KV yet. Please run sync script.");
      return DEFAULT_KNOWLEDGE;
    }

    return JSON.parse(dataStr);
  } catch (error) {
    console.error("❌ [api-sync-knowledge] Failed to parse knowledge from KV:", error);
    return DEFAULT_KNOWLEDGE;
  }
}