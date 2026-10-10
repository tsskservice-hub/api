/**
 * @file context.ts
 * @description AIYAMATO の教育者としてのコンテキスト構築および動的インストラクション（APIサーバー専用・データ非依存版）
 */

import { AIYAMATO_SYSTEM_PROMPT } from './system-prompt';

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
  appType?: 'writing' | 'oral' | 'general';
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
 * 画像添付時のVision処理・ディスクレパンシーチェックルール
 */
function getVisionHandlingInstructions(hasFiles: boolean, assignedQuestion: string): string {
  if (!hasFiles) return "";

  return `
<input_initial_action>
  - Trigger Condition: An image file of a handwritten response is uploaded by the student.
  - Direct Vision Transcription & Echo Output:
    1. State the assigned question: "[Assigned Question] : "${assignedQuestion || "General VCE Writing Task"}""
    2. Transcribe the student's handwritten response from the uploaded image.
    3. Output the transcription markdown format block at the beginning.
</input_initial_action>

<discrepancy_check>
  - Pre-Feedback Comparison: Compare the topic of assigned_question vs the transcribed text.
  - CASE 0 (No Question Selected): Output warning and terminate.
  - CASE 1 (On-Topic): Proceed with full feedback in English.
  - CASE 2 (Discrepancy Detected): Output major warning and terminate session to prevent zero marks in the real exam.
</discrepancy_check>

<language_requirement>
  - CRITICAL RULE FOR IMAGE FEEDBACK: Except for direct Japanese transcription and quoted examples, ALL explanations, corrections, and hints must be written entirely in English.
</language_requirement>`.trim();
}

/**
 * VCE特有の追加ルールおよびポリシー
 */
function getVceSpecificRules(): string {
  return `
<vce_specific_rules>
- VCE Greeting Focus: Reflect practice session appropriately.
- VCAA Exam Info Policy:
  - NO UNSOLICITED EXAM STEERING.
  - STRICT VCAA WEBSITE REDIRECTION: If asked about official specs or rules, direct them to the official VCAA website (https://www.vcaa.vic.edu.au/assessment/vce/examination-specifications-past-examinations-and-examination-reports/languages/japanese-second-language) without guessing numbers.
<writing_exam_focus_rules>
- Genkoyoshi Layout & Character Count Vigilance (400-500 characters).
- Active use of VCE kanji and vocabulary.
</writing_exam_focus_rules>
</vce_specific_rules>`.trim();
}

/**
 * LLMに渡す最終的なコンテキストを構築するメイン関数
 */
export function buildAiYamatoContext(options: PersonaContextOptions = {}): string {
  const {
    userEmail = "",
    userNickname = "",
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
  - Student Email: ${userEmail}
  - User ID: ${userEmail}
  - User nickname: ${userNickname || "Student"}
  - Active Question / Task: ${assignedQuestion}
  - Character count: ${exactCharacterCount}
  - Student Learning pace: ${learningPace}
  - User State (Returning): ${isReturningUser}
  - Has Uploaded Image: ${hasFiles ? "Yes" : "No"}
  - Dialogue Turn: ${dialogueCount}
  - Question Source Mode: ${questionSource || "curriculum"}
  - App Type: ${appType}
</student_metadata>`.trim();
  sections.push(metadataSection);

  const greetingRule = isReturningUser === "true"
    ? `Start your greeting with: "Hello again! 🌟 Welcome back to your VCE Japanese practice session!"`
    : `Start your greeting with: "Hello! 🌟 Welcome to your VCE Japanese practice session!"`;
  
  sections.push(`<greeting_rules>\n  - ${greetingRule}\n</greeting_rules>`);

  sections.push(getVceSpecificRules());

  const visionInstructions = getVisionHandlingInstructions(hasFiles, assignedQuestion);
  if (visionInstructions) {
    sections.push(visionInstructions);
  }

  if (!hasFiles && dialogueCount === 1) {
    sections.push(`
<handwriting_reminder_rules>
  - Trigger Condition: Student begins with typed text instead of a handwritten photo.
  - Guidance: Naturally weave an encouraging reminder in English to upload a handwritten photo for VCE exam practice.
</handwriting_reminder_rules>`.trim());
  }

  if (appType === "writing") {
    const paceInstruction = getPaceInstruction(learningPace, exactCharacterCount);
    if (paceInstruction) {
      sections.push(paceInstruction);
    }
  } else {
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