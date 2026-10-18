/**
 * @file sync-knowledge.ts
 * @description yamato-portal から同期される教育データ・ナレッジを保持・管理するモジュール
 */

// 同期されたデータを保持するメモリ内ストア（※Workersのインスタンス生存期間内有効。永続化したい場合は Cloudflare KV を推奨）
let syncedPortalKnowledge: {
  faqList?: any[];
  pricePlans?: any;
  kanjiList?: any[];
  vceCriteria?: any;
  lastSyncedAt?: string;
} = {
  faqList: [],
  pricePlans: {},
  kanjiList: [],
  vceCriteria: {},
};

/**
 * yamato-portal から送られたデータを保存する
 */
export function setSyncedKnowledge(data: typeof syncedPortalKnowledge) {
  syncedPortalKnowledge = {
    ...data,
    lastSyncedAt: new Date().toISOString(),
  };
  console.log("📦 [sync-knowledge] Knowledge base synchronized successfully at:", syncedPortalKnowledge.lastSyncedAt);
}

/**
 * プロンプト組み立て時に現在のナレッジを取得する
 */
export function getSyncedKnowledge() {
  return syncedPortalKnowledge;
}