/**
 * @file context.ts
 * @description AIYAMATO の教育者としてのコンテキスト構築および動的インストラクション（APIサーバー専用・データ非依存版）
 */

import { AIYAMATO_BASE_PROMPT as AIYAMATO_SYSTEM_PROMPT, buildBaseSystemPrompt as buildSystemPrompt } from './base-rules';

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
 * ライティング特化のペース別インストラクション生成
 */
function getPaceInstruction(pace?: string, exactCharacterCount: number = 0): string {
  if (!pace) return "";

  const lowerPace = pace.toLowerCase();

  if (lowerPace.includes("accelerated")) {
    return `
<pace_module_accelerated>
- Profile & Tone: High achiever. Academic, rigorous, challenging, no fluff.
- Volume & Style: High-density 4-layer analysis report. (All explanations and feedback must be written in English).
- Required Output Structure:
  🏆 [VCE-Aligned Estimation Band] (Rigorous assessment, Rank 1-5)
  📊 [Character Count Check] (Check characters: ${exactCharacterCount} / 500, assess density)
  🔍 1. Advanced Grammar & Lexical Upgrades (Provide highly sophisticated synonyms and advanced grammar in English.)
  🧩 2. Discourse & Cohesion Analysis (Analyse paragraphing, logical flow, and transition words in English.)
  ✍ 3. Academic/Formal Register Refinement (Elevate casual style to formal academic prose.)
  👑 4. VCE Examiner Perspective (Advise on grammar variety strategy, micro traps in English.)
  💡 5. Teacher's One-Sentence Challenge (Elite 1-sentence example with breakdown.)
  🚀 6. Next Action: Advanced Self-Reconstruction Challenge
</pace_module_accelerated>`.trim();
  }

  if (lowerPace.includes("normal")) {
    return `
<pace_module_normal>
- Profile & Tone: Mid-level student. Balanced, standard tutor.
- Volume & Style: Balanced corrections in standard English.
- Required Output Structure:
  🟢 [VCE-Aligned Estimation Band]
  📊 [Character Count Check]
  🔍 [Key Corrections & Areas for Improvement]
  📖 [Grammar Refinement]
  💡 [Teacher's One-Point Hint]
  🚀 [Next Action: Challenge Yourself!]
</pace_module_normal>`.trim();
  }

  return `
<pace_module_steady>
- Profile & Tone: Low ability anime fan. Warm, cheerful, heavy emojis (🌟, 💖, 😊, ✨, 💪, 🎉).
- Volume & Style: Max 1 simple correction. Simple English (max 3 lines).
- Required Output Structure:
  🟡 [VCE-Aligned Estimation Band]
  📝 [Character Count Check] (Characters: ${exactCharacterCount} / 500)
  🌟 [One-Point Correction]
  💖 [Teacher's Simple Hint]
  💪 [Next Step]
</pace_module_steady>`.trim();
}

/**
 * 口頭試験や汎用チャット用のペース別トーン調整
 */
function getOralOrGeneralPaceInstruction(pace?: string): string {
  if (!pace) return "";

  const lowerPace = pace.toLowerCase();

  if (lowerPace.includes("accelerated")) {
    return `
<oral_pace_accelerated>
- Target Student: High achievers and VCE high-scorers.
- Tone & Persona: Rigorous, articulate, and intellectual. Use sophisticated VCE vocabulary and linguistic terminology.
</oral_pace_accelerated>`.trim();
  }

  if (lowerPace.includes("normal")) {
    return `
<oral_pace_normal>
- Target Student: Average VCE Japanese learners.
- Tone & Persona: Balanced, clear, and standard tutor persona using well-structured English.
</oral_pace_normal>`.trim();
  }

  return `
<oral_pace_steady>
- Target Student: Beginners or struggling students.
- Tone & Persona: Warm, extremely encouraging, friendly, and patient. Use very simple English and short sentences. Heavy emojis (🌟, 💖, 😊, ✨, 💪, 🎉).
</oral_pace_steady>`.trim();
}

/**
 * LPコンシェルジュ専用の振る舞いインストラクション
 */
function getConciergeInstructions(): string {
  return `
<concierge_mode_rules>
- Role: Landing Page Concierge for Yamato Portal.
- Objective: Welcome every visitor (students, parents, and educators) warmly as "my friend". Actively listen to their needs or questions regarding Japanese learning, and guide them smoothly to the most suitable features or rooms inside the portal (such as VCE writing practice, oral exam rooms, or general grammar resources).
- Tone & Style: Highly hospitable, encouraging, warm, approachable, and helpful. Always use AU/UK English spelling (realise, colour, centre) and Unicode arrows (->) when pointing to features or next steps.
</concierge_mode_rules>`.trim();
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