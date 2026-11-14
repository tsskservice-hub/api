/**
 * @file src/prompts/prompt-dispatcher.ts
 * @description appType に応じたシステムプロンプトの動的割り当ておよび未設定エラー検証を行う独立モジュール（Obento全レッスン対応版）
 */

import { buildConciergePrompt } from './concierge';
import { buildGameIgoPrompt } from './game-igo';
import { buildGenkoyoshiGeneralPrompt } from './genkoyoshi-editor-general';
import { buildVceGenkoyoshiPrompt } from './genkoyoshi-editor-vce';
import { buildEoyOralDrillPrompt } from './eoy-oral-drill';
import { buildEoyOralAcceleratedPrompt } from './eoy-oral-accelerated'; // 💡 新規：Accelerated用プロンプトのインポート
import { buildEoyOralElaboratePrompt } from './eoy-oral-elaborate';
import { buildEoyOralMockPrompt } from './eoy-oral-mock';
import { buildEoyWritingPrompt } from './eoy-writing';
import { buildOralExamQuestionsPrompt } from './oral-exam-questions';
import { buildKanjiGrammarCheckerVCEPrompt } from './kanji-grammar-checker-vce';
import { buildEoyWritingCustomPrompt } from './eoy-writing-custom';
import { buildImageExplanationYamatoPrompt } from './image-explanation';

// 💡 Obento Deluxe Unit 4〜6 用プロンプトのインポート
import { buildObentoU4YamatoPrompt } from './obento-u4';
import { buildObentoU5YamatoPrompt } from './obento-u5';
import { buildObentoU6YamatoPrompt } from './obento-u6';

export interface PromptOptions {
  userNickname: string;
  faqList?: any[];
  currentTurn: number;
  pace?: string;
  selectedTextType?: string;
  studentEssay?: string;
  exactCharacterCount?: number;
  // 💡 リテラル型に合わせて安全化
  writingSection?: "section2b" | "section3" | "other";
  hasFiles: boolean;
  assignedQuestion: string;
  timeZone?: string;
  cityName?: string;
  env?: any;
}

export interface PromptDispatcherResult {
  success: boolean;
  systemInstructionText?: string;
  errorResponse?: {
    error: string;
    message: string;
    appType: string;
  };
}

/**
 * 💡 appType に応じたシステムプロンプト文字列を非同期生成・振り分け
 * @param appType アプリケーション識別キー
 * @param promptOptions プロンプトパラメータ群
 *
 * 🔐 AI に渡す指示文は、必ずこのファイルで登録したもの（サーバー側）だけを使う。
 *    ブラウザから送られた systemPrompt は受け付けない（AI の役割・安全方針を利用者が差し替えられてしまうため）。
 *    登録されていない appType は、何が送られてきても UNREGISTERED_APP_PROMPT で断る。
 */
export async function dispatchSystemPrompt(
  appType: string,
  promptOptions: PromptOptions
): Promise<PromptDispatcherResult> {
  let systemInstructionText = "";

  switch (appType) {
    case "concierge":
      systemInstructionText = await buildConciergePrompt({ ...promptOptions, env: promptOptions.env });
      break;
    case "game-igo":
      systemInstructionText = await buildGameIgoPrompt(promptOptions);
      break;
    case "genkoyoshi-editor-general":
      systemInstructionText = await buildGenkoyoshiGeneralPrompt(promptOptions);
      break;
    case "genkoyoshi-editor-vce":
      systemInstructionText = await buildVceGenkoyoshiPrompt(promptOptions);
      break;
    case "kanji-grammar-checker-vce":
      systemInstructionText = await buildKanjiGrammarCheckerVCEPrompt(promptOptions);
      break;
    case "eoy-oral-drill":
    case "eoy-oral-drill-chat":
      systemInstructionText = await buildEoyOralDrillPrompt(promptOptions);
      break;
    case "eoy-oral-accelerated": // 💡 専用の accelerated プロンプトビルダーに紐づけ
      systemInstructionText = await buildEoyOralAcceleratedPrompt(promptOptions);
      break;
    case "eoy-oral-elaborate":
    case "eoy-oral-elaborate-chat":
      systemInstructionText = await buildEoyOralElaboratePrompt(promptOptions);
      break;
    case "eoy-oral-mock":
      systemInstructionText = await buildEoyOralMockPrompt(promptOptions);
      break;
    case "eoy-writing":
      systemInstructionText = await buildEoyWritingPrompt(promptOptions);
      break;
    case "eoy-writing-custom":
    case "custom":
      // 💡 型を整合させて渡す
      systemInstructionText = await buildEoyWritingCustomPrompt({
        ...promptOptions,
        writingSection: (promptOptions.writingSection as "section2b" | "section3" | "other") || "section2b"
      });
      break;
    case "oral-exam-questions":
      systemInstructionText = await buildOralExamQuestionsPrompt(promptOptions);
      break;
    case "image-explanation":
      systemInstructionText = await buildImageExplanationYamatoPrompt(promptOptions);
      break;

    // 💡 Family（Obento Deluxe Unit 4 に対応）。新しいレッスン ID は family-1〜3。
    //    古い ID（obento-unit-4-lesson-N）は、ポータルを切り替えるまでの間のために残す
    case "family-1":
    case "family-2":
    case "family-3":
    case "obento-u4":
    case "obento-unit4":
    case "obento-unit-4-lesson-1":
    case "obento-unit-4-lesson-2":
    case "obento-unit-4-lesson-3":
      systemInstructionText = await buildObentoU4YamatoPrompt(promptOptions);
      break;

    // 💡 Pets（Obento Deluxe Unit 5 に対応）
    case "pets-1":
    case "pets-2":
    case "obento-u5":
    case "obento-unit5":
    case "obento-unit-5-lesson-1":
    case "obento-unit-5-lesson-2":
    case "obento-unit-5-lesson-3":
      systemInstructionText = await buildObentoU5YamatoPrompt(promptOptions);
      break;

    // 💡 Food（Obento Deluxe Unit 6 に対応）
    case "food-1":
    case "food-2":
    case "obento-u6":
    case "obento-unit6":
    case "obento-unit-6-lesson-1":
    case "obento-unit-6-lesson-2":
    case "obento-unit-6-lesson-3":
      systemInstructionText = await buildObentoU6YamatoPrompt(promptOptions);
      break;

    default:
      console.error(`❌ Unregistered appType or missing prompt builder: '${appType}'`);
      return {
        success: false,
        errorResponse: {
          error: "UNREGISTERED_APP_PROMPT",
          message: `専用プロンプトが未設定の appType です: '${appType}'。`,
          appType: appType,
        },
      };
      break;
  }

  return {
    success: true,
    systemInstructionText,
  };
}

export default dispatchSystemPrompt;