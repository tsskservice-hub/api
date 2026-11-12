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
 * kl_app の key → [グループ名 | null, プロパティ名]
 * グループ名が null のときはトップレベルに置く。プロンプト側（src/prompts/*）が読む名前に合わせること。
 * VCE 系の値は vceResources と vceCriteria の両方から読まれるため両方に置く（下の VCE_SHARED_PROPS 参照）。
 */
const KL_APP_KEY_MAP: Record<string, [string | null, string]> = {
  FAQ: [null, 'faqList'],
  faqList: [null, 'faqList'],
  LEGAL_CONTENTS: [null, 'legalContent'],
  legalContent: [null, 'legalContent'],
  DAILY_QUIZZES: [null, 'quizzes'],
  quizzes: [null, 'quizzes'],
  PRICE_PLANS: [null, 'pricePlans'],
  pricePlans: [null, 'pricePlans'],
  portalContent: [null, 'portalContent'],
  WRITING_EXAM_QUESTIONS: ['vceResources', 'writingExamQuestions'],
  ORAL_EXAM_QUESTIONS: ['vceResources', 'oralExamQuestions'],
  TEXTTYPES: ['vceCriteria', 'textTypes'],
  WRITING_STYLES: ['vceCriteria', 'writingStyles'],
  VCE_GRAMMAR_LIST: ['vceCriteria', 'grammarList'],
  VCE_EOY_WRITTEN_CRITERIA: ['vceCriteria', 'eoyWrittenCriteria'],
  VCE_EOY_WRITTEN_SPEC: ['vceCriteria', 'eoyWrittenSpec'],
  VCE_EOY_WRITTEN_REPORT2025: ['vceCriteria', 'eoyWrittenReport2025'],
  VCE_EOY_ORAL_CRITERIA: ['vceCriteria', 'eoyOralCriteria'],
  VCE_EOY_ORAL_SPEC: ['vceCriteria', 'eoyOralSpec'],
  VCE_EOY_ORAL_REPORT2025: ['vceCriteria', 'eoyOralReport2025'],
  VCE_EOY_ORAL_ADVICE2026: ['vceCriteria', 'eoyOralAdvice2026'],
};

// vceCriteria と vceResources の両方から読まれるプロパティ
const VCE_SHARED_PROPS = ['textTypes', 'grammarList', 'writingStyles'];

/** VCE_U3O1_DESCRIPTOR → ['vceCriteria', 'u3o1Descriptor'] */
function mapDescriptorKey(key: string): [string, string] | null {
  const m = /^VCE_U(\d)O(\d)_DESCRIPTOR$/.exec(key);
  return m ? ['vceCriteria', `u${m[1]}o${m[2]}Descriptor`] : null;
}

/** data が { quizzes: [...] } のように同名プロパティで包まれていれば中身を取り出す */
function unwrap(data: any, prop: string) {
  if (data && typeof data === 'object' && !Array.isArray(data) && prop in data) {
    return data[prop];
  }
  return data ?? {};
}

/**
 * LP（yamato-portal の PortalModulesGrid）と同じ見出し・並びで表示されるモジュール一覧の元データ。
 * 各行の data は配列、または { modules: [...] } の形（yamato-portal/app/data/content-*.ts と同じ解釈）。
 */
const PORTAL_MODULE_SECTIONS: Array<{ key: string; title: string }> = [
  { key: 'CONTENT_VCE_SPEAKING', title: 'VCE Speaking' },
  { key: 'CONTENT_VCE_WRITING', title: 'VCE Writing' },
  { key: 'CONTENT_REFERENCE', title: 'VCE Writing References & Guides' },
  { key: 'CONTENT_JUNIOR', title: 'Years 7–10 Japanese' },
  { key: 'CONTENT_GENERAL', title: 'Global & General Japanese Learners' },
];

/**
 * kl_app の CONTENT_* 行から concierge 用の portalContent を組み立てる
 * - sections: [{ title, modules }]（CONTENT_GAMES は sections[].games をモジュールとして追加）
 * - systemRules: CONTENT_OTHER.systemRules（ウェルカムクレジット・クイズ報酬など）
 */
function buildPortalContent(rows: Array<{ key: string; data: any }>) {
  const byKey = new Map(rows.map((r) => [r.key, r.data]));
  const parse = (d: any) => (typeof d === 'string' ? JSON.parse(d) : d);

  const sections: Array<{ title: string; modules: any[] }> = [];
  for (const { key, title } of PORTAL_MODULE_SECTIONS) {
    const d = parse(byKey.get(key));
    const modules = Array.isArray(d) ? d : d?.modules || [];
    if (modules.length > 0) sections.push({ title, modules });
  }

  const games = parse(byKey.get('CONTENT_GAMES'));
  if (games && Array.isArray(games.sections)) {
    const gameModules = games.sections.flatMap((s: any) =>
      (s.games || []).map((g: any) => ({ ...g, category: g.category || s.title }))
    );
    if (gameModules.length > 0) {
      sections.push({ title: games.title || 'Interactive Learning Arcade & Games', modules: gameModules });
    }
  }

  const other = parse(byKey.get('CONTENT_OTHER'));
  return {
    sections,
    systemRules: other?.systemRules || {},
  };
}

/**
 * Supabase から最新のナレッジを非同期で取得する
 * 💡 キャッシュは持たず、呼ばれるたびに Supabase を直接読む（Supabase を直せば次のリクエストから反映される）
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
    // 💡 DEFAULT_KNOWLEDGE の入れ子オブジェクトをリクエスト間で共有・汚染しないよう深いコピーを使う
    let combinedData: any = structuredClone(DEFAULT_KNOWLEDGE);
    let latestUpdatedAt = null;

    if (!appError && appData) {
      // LATEST_KNOWLEDGE（旧・一括保存形式）を先に適用し、個別キーの行が必ず優先されるようにする
      const sortedRows = [...appData].sort(
        (a, b) => Number(b.key === 'LATEST_KNOWLEDGE') - Number(a.key === 'LATEST_KNOWLEDGE')
      );

      for (const row of sortedRows) {
        // 💡 kl_app のキー → プロンプトが読むプロパティへのマッピング
        const mapped = KL_APP_KEY_MAP[row.key] || mapDescriptorKey(row.key);
        if (mapped) {
          const [group, prop] = mapped;
          const value = unwrap(row.data, prop);
          if (group) {
            combinedData[group] = { ...(combinedData[group] || {}), [prop]: value };
          } else {
            combinedData[prop] = value;
          }
          if (!latestUpdatedAt || (row.updated_at && row.updated_at > latestUpdatedAt)) {
            latestUpdatedAt = row.updated_at;
          }
          continue;
        }

        const k = row.key;
        const val = row.data || {};

        // 更新日時の新しいものを記録
        if (!latestUpdatedAt || (row.updated_at && row.updated_at > latestUpdatedAt)) {
          latestUpdatedAt = row.updated_at;
        }

        if (k === 'LATEST_KNOWLEDGE') {
          // 従来の単一JSON一括保存データがある場合（個別キーより先に適用される）
          combinedData = { ...combinedData, ...val };
        } else {
          // マッピング未定義のキー（CONTENT_* / YAMATO_CONFIGS など）は小文字キー名で保持
          combinedData[k.toLowerCase()] = val;
        }
      }

      // 💡 LP と同じ CONTENT_* 行から portalContent を組み立てる（旧 PORTAL_CONTENT の代わり）
      if (!combinedData.portalContent || Object.keys(combinedData.portalContent).length === 0) {
        combinedData.portalContent = buildPortalContent(appData);
      }

      // textTypes / grammarList / writingStyles は vceResources からも読まれるため両方に置く
      combinedData.vceResources = combinedData.vceResources || {};
      for (const prop of VCE_SHARED_PROPS) {
        const v = combinedData.vceCriteria?.[prop];
        if (v !== undefined) combinedData.vceResources[prop] = v;
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
      // genkoyoshi-editor-vce / eoy-writing-custom はトップレベルの kanjiList を読むため同じものを置く
      combinedData.kanjiList = formattedKanjiList;
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