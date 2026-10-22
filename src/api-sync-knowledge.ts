/**
 * @file api-sync-knowledge.ts (Supabase版)
 * @description Supabase から最新の教育データ・ナレッジを取得するモジュール
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

    // app_knowledge テーブルから 'LATEST_KNOWLEDGE' キーのデータを取得
    const { data, error } = await supabase
      .from('app_knowledge')
      .select('data, updated_at')
      .eq('key', 'LATEST_KNOWLEDGE')
      .single();

    if (error || !data) {
      console.warn("⚠️ [api-sync-knowledge] No knowledge found in Supabase yet:", error?.message);
      return DEFAULT_KNOWLEDGE;
    }

    return {
      ...(data.data || {}),
      lastSyncedAt: data.updated_at,
    };
  } catch (error) {
    console.error("❌ [api-sync-knowledge] Failed to fetch knowledge from Supabase:", error);
    return DEFAULT_KNOWLEDGE;
  }
}