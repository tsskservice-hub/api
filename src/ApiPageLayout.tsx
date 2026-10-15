/**
 * @file ApiPageLayout.tsx
 * @description バックエンド専用の共通プロンプトレイアウト（PageLayout思想の統合版）
 */

import { buildFoundationPrompt, FoundationOptions } from "./foundation";

/**
 * 各ヤマトの固有プロンプト生成関数に渡される共通オプションの型定義
 */
export interface ApiPageLayoutOptions extends FoundationOptions {
  portalData?: any; // ★ ここに portalData の定義を追加
}

/**
 * 【バックエンド版 PageLayout】
 */
export async function ApiPageLayout(
  specificContent: string,
  options: ApiPageLayoutOptions = {}
): Promise<string> {
  return await buildFoundationPrompt(specificContent, options);
}

export default ApiPageLayout;