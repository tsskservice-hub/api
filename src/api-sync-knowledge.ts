/**
 * @file api-sync-knowledge.ts
 * @description yamato-portal から同期される教育データ・ナレッジを保持・管理するモジュール
 */

// 同期されたデータを保持するメモリ内ストア
let syncedPortalKnowledge: {
  faqList?: any[];
  legalContent?: any;
  pricePlans?: any;
  quizzes?: any;
  vceResources?: {
    kanjiList?: any[];
    vceVocabularyList?: any[];
    oralExamQuestions?: any[];
    writingExamQuestions?: any[];
    textTypes?: any;
    grammarList?: any;
    writingStyles?: any;
  };
  vceCriteria?: {
    eoyWrittenCriteria?: any;
    eoyWrittenReport2025?: any;
    eoyWrittenSpec?: any;
    eoyOralAdvice2026?: any;
    eoyOralReport2025?: any;
    eoyOralSpec?: any;
    oralCriteria?: any;
    u3o1Descriptor?: any;
    u3o2Descriptor?: any;
    u3o3Descriptor?: any;
    u4o1Descriptor?: any;
    u4o2Descriptor?: any;
    u4o3Descriptor?: any;
  };
  lastSyncedAt?: string;
} = {
  faqList: [],
  legalContent: {},
  pricePlans: {},
  quizzes: {},
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
};

/**
 * yamato-portal から送られたデータを保存する
 */
export function setSyncedKnowledge(data: any) {
  syncedPortalKnowledge = {
    ...data,
    lastSyncedAt: new Date().toISOString(),
  };
  console.log("📦 [api-sync-knowledge] Knowledge base synchronized successfully at:", syncedPortalKnowledge.lastSyncedAt);
}

/**
 * プロンプト組み立て時に現在のナレッジを取得する
 */
export function getSyncedKnowledge() {
  return syncedPortalKnowledge;
}