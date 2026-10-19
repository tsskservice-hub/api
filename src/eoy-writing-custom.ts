/**
 * @file eoy-writing-custom.ts
 * @description カスタム教材・過去問持ち込み型 EOY Writing Practice ヤマト専用プロンプト生成関数（文字起こし・文字数表示限定版）
 */
import { YamatoApiCommon, YamatoApiCommonOptions } from "./YamatoApiCommon";
import { getSyncedKnowledge } from "./api-sync-knowledge"; // 💡 API側の同期済みナレッジをインポート

/**
 * ★ 画像が添付された際のルール：指定された問題、文字起こし、文字数のみを出力する
 */
function getVisionHandlingInstructions(hasFiles: boolean, assignedQuestion: string): string {
  if (!hasFiles) return "";

  const hasAssignedQuestion = Boolean(assignedQuestion && assignedQuestion.trim() !== "");

  return `
<CRITICAL_VISION_HANDLING_AND_DISCREPANCY_RULES>
  - TRIGGER CONDITION: An image file of a handwritten response is uploaded by the student.
  - ABSOLUTE RULE: When an image is attached, you MUST output ONLY the following three lines and absolutely nothing else. Do not add greetings, advice, or any other text.

  [Assigned Question] : "${assignedQuestion || "None selected"}"
  [Transcribed Text] : <Insert direct transcription of the student's handwritten Japanese text from the image here>
  [Character Count] : <Insert the exact character count of the transcribed text, e.g., 25 characters>
</CRITICAL_VISION_HANDLING_AND_DISCREPANCY_RULES>
  `.trim();
}

/**
 * ★ ライティング特化のペース別インストラクション生成（※現在は一時的にコメントアウトして無効化）
 */
function getPaceInstruction(pace?: string, exactCharacterCount: number = 0): string {
  /*
  const activePace = (pace && pace.trim() !== "" ? pace : "normal").toLowerCase();
  ...
  */
  return ""; // 後の部分の出力を完全に停止するため空文字を返す
}

export interface EoyWritingCustomPromptOptions extends YamatoApiCommonOptions {
  pace?: string;
  exactCharacterCount?: number;
  selectedTextType?: string;
  studentEssay?: string;
  hasFiles?: boolean;
  assignedQuestion?: string;
  timeZone?: string;
  cityName?: string;
}

export async function buildEoyWritingCustomPrompt(options: EoyWritingCustomPromptOptions = {}): Promise<string> {
  const { 
    pace = "", 
    exactCharacterCount = 0, 
    selectedTextType = "", 
    studentEssay = "", 
    hasFiles = false,
    assignedQuestion = "",
    ...baseOptions 
  } = options;

  const syncedKnowledge = getSyncedKnowledge() as any;
  const effectiveFaqList = syncedKnowledge?.faqList || [];

  const essayText = studentEssay;
  const charCount = exactCharacterCount > 0 ? exactCharacterCount : essayText.length;

  const visionHandlingText = getVisionHandlingInstructions(hasFiles, assignedQuestion);

  let activeSessionContext = "";
  if (selectedTextType || essayText || assignedQuestion) {
    activeSessionContext = `
  <current_student_work>
    - Assigned Question (Custom Prompt): "${assignedQuestion || "Not specified yet"}"
    - Selected Text Type (Format): ${selectedTextType || "Not specified yet"}
    - Current Student Essay / Text:
      "${essayText || "No essay provided yet."}"
  </current_student_work>
`;
  }

  const EOY_WRITING_CUSTOM_SPECIFIC_CONTEXT = `
<system_context>
  ${visionHandlingText}

  <identity>
    - Tutor's Name: "EOY Writing Custom Practice Yamato" (カスタムEOYライティング練習ヤマト).
    - Role: An expert VCE Japanese examination writing coach.
  </identity>

  ${activeSessionContext}
</system_context>
  `.trim();

  return await YamatoApiCommon(EOY_WRITING_CUSTOM_SPECIFIC_CONTEXT, {
    ...baseOptions,
    faqList: effectiveFaqList,
    timeZone: options.timeZone,
    cityName: options.cityName,
  });
}

export default buildEoyWritingCustomPrompt;