/**
 * @file api-sync-knowledge.ts (Supabase版・全キー統合対応)
 * @description Supabase から最新の教育データ・ナレッジの取得、および Supabase への保存・同期を行うモジュール
 */

import { createClient } from '@supabase/supabase-js';

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
 * Supabase から最新のナレッジを非同期で取得する
 */
export async function getSyncedKnowledge(env: any) {
  // Cloudflare Workers の env から取得
  const supabaseUrl = env?.SUPABASE_URL;
  // Service Role Key を優先的に取得
  const supabaseKey = env?.SUPABASE_SERVICE_ROLE_KEY || env?.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.warn("⚠️ [api-sync-knowledge] Supabase credentials (URL or Service Role Key) are missing in env. Returning default knowledge.");
    return DEFAULT_KNOWLEDGE;
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseKey);

    // 💡 app_knowledge テーブルからすべての行を一括取得し、個別の key ごとに組み立てる
    const { data, error } = await supabase
      .from('app_knowledge')
      .select('key, data, updated_at');

    if (error || !data || data.length === 0) {
      console.warn("⚠️ [api-sync-knowledge] No knowledge found in Supabase yet:", error?.message);
      return DEFAULT_KNOWLEDGE;
    }

    // 取得した行データを結合するためのベースオブジェクト
    let combinedData: any = { ...DEFAULT_KNOWLEDGE };
    let latestUpdatedAt = null;

    for (const row of data) {
      const k = row.key;
      const val = row.data || {};

      // 更新日時の新しいものを記録
      if (!latestUpdatedAt || (row.updated_at && row.updated_at > latestUpdatedAt)) {
        latestUpdatedAt = row.updated_at;
      }

      // 💡 登録したキーに応じて適切なプロパティにマッピングする
      if (k === 'LATEST_KNOWLEDGE') {
        // 従来の単一JSON一括保存データがある場合
        combinedData = { ...combinedData, ...val };
      } else if (k === 'LEGAL_CONTENTS' || k === 'legalContent') {
        combinedData.legalContent = val;
      } else if (k === 'DAILY_QUIZZES' || k === 'quizzes') {
        // val が { quizzes: [...] } の形、または直接 [...] の形どちらにも対応
        combinedData.quizzes = val.quizzes || val;
      } else if (k === 'pricePlans' || k === 'PRICE_PLANS') {
        combinedData.pricePlans = val;
      } else if (k === 'portalContent') {
        combinedData.portalContent = val;
      } else {
        // その他のカスタムキーがあればそのままキー名で保持
        combinedData[k.toLowerCase()] = val;
      }
    }

    return {
      ...combinedData,
      lastSyncedAt: latestUpdatedAt,
    };
  } catch (error) {
    console.error("❌ [api-sync-knowledge] Failed to fetch knowledge from Supabase:", error);
    return DEFAULT_KNOWLEDGE;
  }
}

/**
 * 💡 yamato-portal 側から送信されたナレッジデータを Supabase に保存・更新する
 */
export async function setSyncedKnowledge(body: any, env: any) {
  const supabaseUrl = env?.SUPABASE_URL;
  const supabaseKey = env?.SUPABASE_SERVICE_ROLE_KEY || env?.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Supabase credentials (URL or Service Role Key) are missing in environment variables.");
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // 送信されたデータ構造に応じて upsert を実行
  // 例として全体データを 'LATEST_KNOWLEDGE' キーとして一括保存、または各プロパティごとに分割保存する方式に対応
  const payloadKey = body.key || 'LATEST_KNOWLEDGE';
  const payloadData = body.data || body;

  const { error } = await supabase
    .from('app_knowledge')
    .upsert(
      {
        key: payloadKey,
        data: payloadData,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'key' }
    );

  if (error) {
    throw new Error(`Failed to upsert knowledge to Supabase: ${error.message}`);
  }

  return true;
}