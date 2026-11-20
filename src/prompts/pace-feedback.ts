/**
 * @file src/prompts/pace-feedback.ts
 * @description 生徒の learning pace（steady / normal / accelerated。profiles.learning_pace）に合わせて、
 *              フィードバックの量・内容・言い方を変えるための共通の決まり
 *
 * 決まり（2026-11-21。ユーザーの指示）: どのページのどのタスクでも、フィードバックは learning pace に合わせる。
 *   ・FoundationLayout.ts（チャットのヤマトの土台）は PACE_FEEDBACK_RULES を必ず入れる → 土台を通るヤマトは全部これに従う
 *   ・土台を通らないフィードバック（ヤマトタウン・教科書ページのライティングなど）は paceFeedbackRule(pace) を入れる
 *   ・タスク専用の pace の決まり（EOY Oral の模擬試験・Drill・Elaborate、EOY Writing など）がある場合は、そちらが優先
 * 新しくフィードバックを出す機能を作るときは、必ずこのどちらかを入れる。
 */

export type LearningPace = 'steady' | 'normal' | 'accelerated';

export function normalizePace(value: unknown): LearningPace {
  const p = String(value ?? '').toLowerCase();
  if (p.includes('steady')) return 'steady';
  if (p.includes('accelerated')) return 'accelerated';
  return 'normal';
}

/** pace ごとの、直す点の数の上限（タスクの形に数を入れるときに使う） */
export const PACE_MAX_CORRECTIONS: Record<LearningPace, number> = { steady: 3, normal: 5, accelerated: 7 };

const PACE_TEXT: Record<LearningPace, string> = {
  steady: `steady — the student finds Japanese hard or is a beginner.
    - Tone: warm, cheerful and very encouraging. Simple English, short sentences, no grammar jargon (or explain it in plain words).
    - Amount: SHORT. Start with 1–2 specific things they did well. Then at most ${PACE_MAX_CORRECTIONS.steady} corrections, only the most important ones (meaning first, then basic grammar). Ignore small or advanced points.
    - Content: give a simple, correct model sentence the student can copy. End with ONE easy next step.`,
  normal: `normal — a typical student at the expected level.
    - Tone: friendly and clear.
    - Amount: MEDIUM. 2–3 specific strengths, then up to ${PACE_MAX_CORRECTIONS.normal} corrections with a short reason each.
    - Content: where useful, show one more natural way to say something. End with 1–2 clear next steps.`,
  accelerated: `accelerated — a high achiever who wants to be challenged.
    - Tone: concise and rigorous; no fluff, but still respectful.
    - Amount: DETAILED. Brief strengths, then up to ${PACE_MAX_CORRECTIONS.accelerated} points, including accuracy, naturalness, register/politeness and range of vocabulary and grammar.
    - Content: offer more sophisticated alternatives and explain the nuance. End with a challenging next task.`,
};

/** 3 つの pace をすべて書いた決まり（土台のプロンプト用。生徒の pace は student_metadata にある） */
export const PACE_FEEDBACK_RULES = `<learning_pace_feedback_rules>
  - Whenever you give the student feedback (corrections, evaluation, comments on their Japanese, a summary of how they did), adapt the AMOUNT, DEPTH and TONE of the feedback to "Student Learning Pace" in student_metadata. If it is empty or unknown, use normal.
  - If the task-specific instructions above include their own pace rules or pace modules, follow those first; these rules fill in anything they do not cover.
  - Always keep the task's required output format (headers, JSON, language rules). Change only how much you say and how you say it.
  - Pace definitions:
    * ${PACE_TEXT.steady}
    * ${PACE_TEXT.normal}
    * ${PACE_TEXT.accelerated}
</learning_pace_feedback_rules>`;

/** 1 人の生徒の pace だけを書いた決まり（土台を通らないフィードバック用） */
export function paceFeedbackRule(pace: unknown): string {
  const p = normalizePace(pace);
  return `<learning_pace_feedback_rules>
  - The student's learning pace is: ${PACE_TEXT[p]}
  - Adapt the amount, depth and tone of ALL feedback to this pace. Keep the required output format.
</learning_pace_feedback_rules>`;
}
