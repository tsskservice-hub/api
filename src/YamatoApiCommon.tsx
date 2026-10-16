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
 * 各ヤマトの固有プロンプト生成関数に渡される共通オプションの型定義
 */
export interface YamatoApiCommonOptions extends FoundationLayoutOptions {
  portalData?: any; // ★ ここに portalData の定義を追加
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