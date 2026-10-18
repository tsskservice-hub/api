/**
 * @file YamatoApiCommon.tsx
 * @description バックエンド専用の共通プロンプトレイアウト（PageLayout思想の統合版・portalData完全排除対応）
 * 
 * ==============================================================================
 * 【他のファイルとの関係性について】
 * - このファイル（YamatoApiCommon.tsx）と裏方で直結している `FoundationLayout.ts`、
 *   そして新しくヤマトを作る際のひな形である `a-template.ts` との詳しい関係性や
 *   パイプライン構造については、すべて `a-template.ts` のファイル上部に記載されています。
 * ==============================================================================
 */

import { buildFoundationLayoutPrompt, FoundationLayoutOptions } from "./FoundationLayout";

/**
 * YamatoApiCommon のメタデータ型定義
 */
export interface YamatoApiCommonMetaType {
  version: string;
  moduleName: string;
  role: string;
  architectureNotes: string[];
  pipelineRules: {
    ruleName: string;
    description: string;
  }[];
  parametersSpec: {
    paramName: string;
    type: string;
    required: boolean;
    description: string;
  }[];
}

/**
 * 構造化メタデータ（コード近接配置）
 */
export const YAMATO_API_COMMON_META: YamatoApiCommonMetaType = {
  version: "2.0.0",
  moduleName: "YamatoApiCommon",
  role: "バックエンド共通プロンプトレイインジェクションおよびオプション制御レイヤー（portalData完全排除版）",
  architectureNotes: [
    "FoundationLayout をラップし、バックエンド共通のオプションや同期済みナレッジを統合する",
    "単一責任の原則に基づき、LLMリクエスト前の共通前処理およびパイプライン構築を担う",
    "フロントエンドのテスト画面（test-yamato.tsx）へエコシステム仕様を動的同期する"
  ],
  pipelineRules: [
    {
      ruleName: "Options Inheritance",
      description: "FoundationLayoutOptions を継承し、すべてのヤマト固有オプションを安全かつ型安全に伝播させる"
    },
    {
      ruleName: "Prompt Assembly",
      description: "個別ヤマト固有の specificContent と統合オプションを buildFoundationLayoutPrompt に渡し、最終的なシステムプロンプトを構築する"
    }
  ],
  parametersSpec: [
    {
      paramName: "specificContent",
      type: "string",
      required: true,
      description: "各ヤマトの個別ルール・ペルソナ・タスク定義を含むメインのプロンプトテキスト"
    },
    {
      paramName: "options",
      type: "YamatoApiCommonOptions",
      required: false,
      description: "FoundationLayoutOptions およびAPI同期ナレッジを受け渡す拡張オプション"
    }
  ]
};

/**
 * 各ヤマトの固有プロンプト生成関数に渡される共通オプションの型定義
 */
export interface YamatoApiCommonOptions extends FoundationLayoutOptions {
  // portalData は API側の syncedKnowledge に完全に移行したため削除されました
}

/**
 * 【バックエンド版 YamatoChatCommon】
 */
export async function YamatoApiCommon(
  specificContent: string,
  options: YamatoApiCommonOptions = {}
): Promise<string> {
  return await buildFoundationLayoutPrompt(specificContent, options);
}

export default YamatoApiCommon;