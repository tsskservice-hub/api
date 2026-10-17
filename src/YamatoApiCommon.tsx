/**
 * @file YamatoApiCommon.tsx
 * @description バックエンド専用の共通プロンプトレイアウト（PageLayout思想の統合版）
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
  version: "1.0.0",
  moduleName: "YamatoApiCommon",
  role: "バックエンド共通プロンプトレイインジェクションおよびオプション制御レイヤー",
  architectureNotes: [
    "FoundationLayout をラップし、バックエンド固有のオプション（portalData等）を統合する",
    "単一責任の原則に基づき、LLMリクエスト前の共通前処理およびパイプライン構築を担う",
    "フロントエンドのテスト画面（test-yamato.tsx）へエコシステム仕様を動的同期する"
  ],
  pipelineRules: [
    {
      ruleName: "Options Inheritance",
      description: "FoundationLayoutOptions を継承し、すべてのヤマト固有オプションとポータルデータを安全に型安全で伝播させる"
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
      description: "FoundationLayoutOptions およびポータル連携用 portalData を含む拡張オプション"
    }
  ]
};

/**
 * 各ヤマトの固有プロンプト生成関数に渡される共通オプションの型定義
 */
export interface YamatoApiCommonOptions extends FoundationLayoutOptions {
  portalData?: any; // portalData の定義
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