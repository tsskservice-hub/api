/**
 * @file a-template.tsx
 * @description 新しいヤマト（AIペルソナ）を作成するための汎用テンプレート。
 * 
 * ==============================================================================
 * 🚀 [FoundationLayout.ts] (エンジン搭載の土台)
 *  └── 🛠️ [YamatoApiCommon.tsx] (ロケットの外装・窓口)
 *       └── 👨‍✈️ [a-template.ts のひな形にペルソナを入れる] (乗組員)
 *            ↓
 *      🌟 完成：個別ヤマト！
 * ==============================================================================
 * 
 * 【新しいヤマトを作るときはどっちを開く？】
 * - 新しいヤマトを作るときは、まずこの **`a-template.tsx`** を開きます（ここがスタート地点です）。
 * - `YamatoApiCommon.tsx` は、いわば裏方で、すべてのヤマトの共通土台です。全ヤマト共通のルールを
 *   変更したいとき以外、新しいヤマトを作るたびに触る必要はありません。
 * ==============================================================================
 * 
 * 【アーキテクチャとロケットの例え（関係性のまとめ）】
 * - プロンプト生成の構造は、次のような「ロケットのパーツ組立」に例えられます：
 *   1. `FoundationLayout.ts`: 大元のエンジンルーム（共通ルール・基礎構造）
 *   2. `YamatoApiCommon.tsx`: それを包む外装（共通の窓口・基盤レイアウト）
 *   3. `a-template.ts`: ひな形（ここに「乗組員＝ペルソナ」をカプセル化して差し込む）
 * - これらが結合することで、「単語ヤマト」や「文法ヤマト」という一つの完成したモジュールが組み上がります。
 * ==============================================================================
 * 
 * 【新しいヤマトを作る手順】
 * 1. ファイル名を目的のものに変更する（例: grammarYamato.ts など）
 * 2. インターフェース名を変更する（例: CustomYamatoOptions ➔ GrammarYamatoOptions）
 * 3. 関数名を変更する（例: buildCustomYamatoPrompt ➔ buildGrammarYamatoPrompt）
 * 4. 固有コンテキスト（ペルソナ・役割）の文字列をそのテーマに合わせて書き換える
 * ==============================================================================
 */

import { YamatoApiCommon, YamatoApiCommonOptions } from "./YamatoApiCommon";

/**
 * 任意のヤマト固有のオプション型定義
 * （新しいヤマトを作る際は、Custom の部分を目的の名前に変更してください）
 */
export interface CustomYamatoOptions extends YamatoApiCommonOptions {
  // 例: targetLevel?: string; など、このヤマト固有の設定があればここに追加
}

/**
 * 汎用的なヤマト・プロンプト生成関数
 * （新しいヤマトを作る際は、関数名を build[Name]YamatoPrompt に変更してください）
 */
export async function buildCustomYamatoPrompt(options: CustomYamatoOptions = {}): Promise<string> {
  const { portalData = {}, ...baseOptions } = options;

  // ==========================================
  // ここに「このヤマト固有の設定（ペルソナ・役割）」を書く
  // ==========================================
  const YAMATO_SPECIFIC_CONTEXT = `
<system_context>
  <identity>
    - Tutor's Name: "[Your Yamato Name] (〇〇ヤマト)".
    - Role: [ここにこのAIの専門役割を記述する].
  </identity>
  <persona_tone>
    - Tone: [ここにトーン＆マナーや指導方針を記述する].
  </persona_tone>
</system_context>
  `.trim();

  // YamatoApiCommon に流し込んで共通レイアウトと結合する
  return await YamatoApiCommon(YAMATO_SPECIFIC_CONTEXT, { portalData, ...baseOptions });
}