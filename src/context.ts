/**
 * @file context.ts
 * @description AIYAMATO の教育者としてのコンテキスト構築および動的インストラクション（APIサーバー専用・データ非依存版）
 */

export interface PersonaContextOptions {
  tone?: string;
  learnerLevel?: string;
  userEmail?: string;
  userNickname?: string;
  assignedQuestion?: string;
  questionId?: number;
  exactCharacterCount?: number;
  learningPace?: 'steady' | 'normal' | 'accelerated' | string;
  isReturningUser?: string;
  hasFiles?: boolean;
  dialogueCount?: number;
  curriculumContext?: string;
  questionSource?: string;
  appType?: 'writing' | 'oral' | 'general' | 'concierge';
}




/**
 * 画像添付時のVision処理・ディスクレパンシーチェックルール
 */
function getVisionHandlingInstructions(hasFiles: boolean, assignedQuestion: string): string {
  if (!hasFiles) return "";

  return `
<input_initial_action>
  - Trigger Condition: An image file is uploaded by the visitor.
  - Direct Vision Transcription & Echo Output:
    1. Acknowledge the uploaded material.
    2. Provide helpful guidance or insights based on the image in English.
</input_initial_action>

<language_requirement>
  - CRITICAL RULE FOR IMAGE FEEDBACK: Except for direct Japanese examples, all explanations and guidance must be written entirely in English.
</language_requirement>`.trim();
}

/**
 * VCE特有の追加ルールおよびポリシー
 */
function getVceSpecificRules(): string {
  return `
<vce_specific_rules>
- VCAA Exam Info Policy:
  - NO UNSOLICITED EXAM STEERING.
  - STRICT VCAA WEBSITE REDIRECTION: If asked about official specs or rules, direct them to the official VCAA website (https://www.vcaa.vic.edu.au/assessment/vce/examination-specifications-past-examinations-and-examination-reports/languages/japanese-second-language) without guessing numbers.
</vce_specific_rules>`.trim();
}

/**
 * LLMに渡す最終的なコンテキストを構築するメイン関数
 */
export function buildAiYamatoContext(options: PersonaContextOptions = {}): string {
  const {
    userEmail = "",
    userNickname = "my friend",
    assignedQuestion = "",
    exactCharacterCount = 0,
    learningPace = "normal",
    isReturningUser = "false",
    hasFiles = false,
    dialogueCount = 1,
    curriculumContext = "",
    questionSource = "",
    appType = "general",
  } = options;

  const sections: string[] = [
    AIYAMATO_SYSTEM_PROMPT.trim(),
  ];

  const metadataSection = `
<student_metadata>
  - Visitor Email: ${userEmail}
  - User ID: ${userEmail}
  - User nickname: ${userNickname || "my friend"}
  - Active Question / Task: ${assignedQuestion}
  - Character count: ${exactCharacterCount}
  - Learning pace: ${learningPace}
  - User State (Returning): ${isReturningUser}
  - Has Uploaded File: ${hasFiles ? "Yes" : "No"}
  - Dialogue Turn: ${dialogueCount}
  - Source Mode: ${questionSource || "portal"}
  - App Type: ${appType}
</student_metadata>`.trim();
  sections.push(metadataSection);

  // appType が concierge の場合とそれ以外で挨拶ルールを分岐
  if (appType === "concierge") {
    sections.push(getConciergeInstructions());
    const greetingRule = isReturningUser === "true"
      ? `Start your greeting with: "Hello again, my friend! 🌟 Welcome back to Yamato Portal. How can I help you explore our learning rooms today?"`
      : `Start your greeting with: "Hello, my friend! 🌟 Welcome to Yamato Portal. I'm Yamato, your portal guide. Whether you're a student, parent, or educator, how can I assist you today?"`;
    sections.push(`<greeting_rules>\n  - ${greetingRule}\n</greeting_rules>`);
  } else {
    const greetingRule = isReturningUser === "true"
      ? `Start your greeting with: "Hello again, my friend! 🌟 Welcome back to your VCE Japanese practice session!"`
      : `Start your greeting with: "Hello, my friend! 🌟 Welcome to your VCE Japanese practice session!"`;
    sections.push(`<greeting_rules>\n  - ${greetingRule}\n</greeting_rules>`);
    sections.push(getVceSpecificRules());
  }

  const visionInstructions = getVisionHandlingInstructions(hasFiles, assignedQuestion);
  if (visionInstructions) {
    sections.push(visionInstructions);
  }

  if (appType === "writing") {
    const paceInstruction = getPaceInstruction(learningPace, exactCharacterCount);
    if (paceInstruction) {
      sections.push(paceInstruction);
    }
  } else if (appType === "oral" || appType === "general") {
    const oralOrGeneralPace = getOralOrGeneralPaceInstruction(learningPace);
    if (oralOrGeneralPace) {
      sections.push(oralOrGeneralPace);
    }
  }

  if (curriculumContext) {
    sections.push(`## Current Session Context\n${curriculumContext}`);
  }

  return sections.join('\n\n');
}

/**
 * 互換性のためのカリキュラム対応コンテキスト生成関数
 */
export function buildCurriculumAwareContext(level: string, tone: string = 'standard'): string {
  return buildAiYamatoContext({
    learningPace: level,
    curriculumContext: `Current learning level context for ${level}.`,
  });
}

/**
 * 外部（portal側）から送られてきた試験問題テキストをそのまま組み込むヘルパー関数
 */
export function buildExamAwareContext(
  questionText?: string, 
  tone: string = 'standard'
): string {
  const curriculumText = questionText 
    ? `Current Writing Exam Practice:\n- Prompt / Task: ${questionText}` 
    : "Using standard VCE Japanese curriculum guidelines.";

  return buildAiYamatoContext({
    assignedQuestion: curriculumText,
    learningPace: "normal",
    curriculumContext: curriculumText,
    appType: "writing",
  });
}

export default buildAiYamatoContext;