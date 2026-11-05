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

    // 1. kl_app テーブルから各種設定（legal, pricePlans など）の行を一括取得し、個別の key ごとに組み立てる
    const { data: appData, error: appError } = await supabase
      .from('kl_app')
      .select('key, data, updated_at');

    // 取得した行データを結合するためのベースオブジェクト
    let combinedData: any = { ...DEFAULT_KNOWLEDGE };
    let latestUpdatedAt = null;

    if (!appError && appData) {
      for (const row of appData) {
        const k = row.key;
        const val = row.data || {};

        // 更新日時の新しいものを記録
        if (!latestUpdatedAt || (row.updated_at && row.updated_at > latestUpdatedAt)) {
          latestUpdatedAt = row.updated_at;
        }

        // 登録したキーに応じて適切なプロパティにマッピングする
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
    } else {
      console.warn("⚠️ [api-sync-knowledge] No app config found in kl_app or error occurred:", appError?.message);
    }

    // 2. kl_character テーブルから最新の漢字データを直接取得し、vceResources.kanjiList にマッピング
    const { data: kanjiRows, error: kanjiError } = await supabase
      .from('kl_character')
      .select('id, character, meaning, kun_display, on_display, grade_level, vce_group')
      .eq('char_type', 'kanji');

    if (!kanjiError && kanjiRows) {
      const formattedKanjiList = kanjiRows.map(item => ({
        id: item.id, // ID付き
        kanji: item.character,
        meaning: item.meaning,
        reading: item.kun_display || item.on_display,
        vceGroup: item.vce_group || 'general',
      }));

      if (!combinedData.vceResources) {
        combinedData.vceResources = {};
      }
      combinedData.vceResources.kanjiList = formattedKanjiList;
    } else {
      console.warn("⚠️ [api-sync-knowledge] Failed to fetch kanji data from kl_character:", kanjiError?.message);
    }

    // 3. kl_vocabulary テーブルから最新の語彙データを直接取得し、vceResources.vceVocabularyList にマッピング
    const { data: vocabRows, error: vocabError } = await supabase
      .from('kl_vocabulary')
      .select('id, word, meaning, reading, romaji, vce_group');

    if (!vocabError && vocabRows) {
      const formattedVocabList = vocabRows.map(item => ({
        id: item.id, // ID付き
        word: item.word,
        meaning: item.meaning,
        reading: item.reading,
        romaji: item.romaji,
        vceGroup: item.vce_group || 'general',
      }));

      if (!combinedData.vceResources) {
        combinedData.vceResources = {};
      }
      combinedData.vceResources.vceVocabularyList = formattedVocabList;
    } else {
      console.warn("⚠️ [api-sync-knowledge] Failed to fetch vocabulary data from kl_vocabulary:", vocabError?.message);
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
 * 💡 yamato-portal 側から送信されたナレッジデータを Supabase に保存・更新する（kl_app 用）
 */
export async function setSyncedKnowledge(body: any, env: any) {
  const supabaseUrl = env?.SUPABASE_URL;
  const supabaseKey = env?.SUPABASE_SERVICE_ROLE_KEY || env?.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Supabase credentials (URL or Service Role Key) are missing in environment variables.");
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // 送信されたデータ構造に応じて upsert を実行
  const payloadKey = body.key || 'LATEST_KNOWLEDGE';
  const payloadData = body.data || body;

  const { error } = await supabase
    .from('kl_app')
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