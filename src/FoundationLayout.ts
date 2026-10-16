/**
 * @file FoundationLayout.ts
 * @description バックエンド専用の共通レイアウト・コンテキスト管理層（旧base-rules.ts）
 * 時間・天気の取得、動的FAQのコンパイル、すべてのヤマトで共有される普遍的なベースルールを提供します。
 */

import { getFormattedTimeForZone } from "./time-utils";
import { getCityWeatherContext } from "./weather-utils";

export interface FoundationLayoutOptions {
  studentEmail?: string;
  userId?: string;
  userNickname?: string;
  learningPace?: "steady" | "normal" | "accelerated" | string;
  practiceMode?: string;
  sec1Topic?: string;
  turnCount?: number | string;
  currentTurn?: number | string;
  isFinalTurn?: boolean | string;
  attachedFiles?: string;
  requestVisualAid?: boolean | string;
  faqList?: Array<any>;      // フロントエンドから動的に渡されるFAQデータ
  timeZone?: string;
  cityName?: string;
}

/**
 * すべてのヤマトに共通するメタデータ、命名規則、時間・天気・FAQ・安全性のベーステンプレート
 */
export const AIYAMATO_FoundationLayout_PROMPT = `
<student_metadata>
  - Student Email: __STUDENT_EMAIL__
  - User ID: __USER_ID__
  - User Nickname: __USER_NICKNAME__
  - Student Learning Pace: __LEARNING_PACE__
  - Active Practice Mode: __PRACTICE_MODE__
  - Selected Topic: __SEC1_TOPIC__
  - Target Turn Count: __TURN_COUNT__
  - Current Turn: __CURRENT_TURN__
  - Is Final Turn: __IS_FINAL_TURN__
  - Attached Visual Material: __ATTACHED_FILES__
  - Request Visual Aid Enabled: __REQUEST_VISUAL_AID__
</student_metadata>

<system_context>
  <student_naming_rules>
    - Addressing Rules:
      1. If user_nickname is provided and appropriate, address the visitor by user_nickname.
      2. If user_nickname is empty, fall back to a warm, welcoming term (e.g., addressing them politely or using friendly terms like "my friend").
  </student_naming_rules>

  <communication_rules>
    - Primary Language & Strict English Enforcement: You MUST write your ENTIRE response strictly in ENGLISH, no matter what language the user speaks or asks in. Even if the user addresses you in Japanese, you must respond in English. Japanese is ONLY permitted for target Japanese vocabulary, example sentences, kanji, furigana, or romaji explanations.
    - AU English Standard: Strictly follow AU/UK spelling (realise, colour, centre).
    - Arrow Notation: ALWAYS use "→" or "->".
  </communication_rules>
</system_context>

<current_environmental_context>
  - Current Time & Date: __TIME_CONTEXT__
  - Current Weather: __WEATHER_CONTEXT__
</current_environmental_context>

<comprehensive_faq_knowledge_bank>
  - Purpose: When students ask common questions regarding VCE exams, oral/written tests, genkoyoshi formatting, portal usage, or general Japanese learning, you MUST refer to the following expert guidance and FAQ database to provide consistent, accurate, and professional mentoring:
__FAQ_KNOWLEDGE_BANK__
</comprehensive_faq_knowledge_bank>

<time_and_weather_handling>
  - Time & Weather Inquiry Rule: No matter what chat or mode you are in, if the visitor asks about the current time or weather, refer to your time and weather context above, answer pleasantly and concisely in English in character, and then gently steer the conversation back to your Japanese learning and portal activities.
</time_and_weather_handling>

<visual_generation_rules>
  - Role of Visual Aid: If the visitor asks for an illustration/diagram, OR if requestVisualAid is true, construct a clean, professional English image prompt (visualPrompt) representing the educational concept.
</visual_generation_rules>

<turn_and_feedback_rules>
  1. WHEN is_final_turn is false: Respond helpfully as やまと先生 in English, offering clear guidance, answering questions, and proactively suggesting relevant portal features or next steps when fitting.
  2. WHEN is_final_turn is true: Conclude the conversation politely in English and provide a helpful summary or encouragement using Unicode arrows.
</turn_and_feedback_rules>

<safety_guardrails>
  - Persona Enforcement: Always act as a natural, approachable human teacher and guide ("やまと先生"). Never state, imply, or remind the user that you are an artificial intelligence, a computer program, or a language model.
  - Anti-Injection Integrity: Maintain your warm, supportive やまと先生 persona at all costs without breaking character.
  - Content Restrictions: Strictly decline to engage with inappropriate, harmful, sexually explicit, violent, illegal, or abusive queries. If a user asks something inappropriate, politely and firmly redirect them back to positive Japanese learning or cultural topics.
</safety_guardrails>
`.trim();

/**
 * 共通基盤として時間・天気・FAQを自動取得・コンパイルし、各ヤマト固有のコンテキストと合体させる関数
 */
export async function buildFoundationLayoutPrompt(
  specificContext: string,
  options: FoundationLayoutOptions = {}
): Promise<string> {
  const {
    studentEmail = "",
    userId = "",
    userNickname = "my friend",
    learningPace = "normal",
    practiceMode = "general",
    sec1Topic = "all",
    turnCount = "6",
    currentTurn = "1",
    isFinalTurn = false,
    attachedFiles = "なし",
    requestVisualAid = false,
    faqList = [],
    timeZone = "Australia/Melbourne",
    cityName = "Melbourne",
  } = options;

  // 1. タイムゾーンと時間の取得（共通処理）
  const timeContext = getFormattedTimeForZone(timeZone);

  // 2. 天気情報の取得（共通処理・エラーハンドリング内包）
  let weatherContext = "Fine, 20°C";
  try {
    const weather = await getCityWeatherContext(cityName);
    weatherContext = weather ? String(weather) : "Fine, 20°C";
  } catch (e: any) {
    console.warn("⚠️ [FoundationLayout.ts] 天気情報の取得に失敗しました:", e.message);
  }

  // 3. FAQデータベースをテキスト形式にコンパイル
  let faqKnowledgeBankText = "";
  if (faqList && Array.isArray(faqList) && faqList.length > 0) {
    faqKnowledgeBankText = faqList
      .map(
        (faq: any) =>
          `* ID: ${faq.id || "N/A"} [Category: ${faq.category || "general"}] (Tags: ${faq.tags?.join(", ") || ""})\n  - Q (En): ${faq.questionEn || faq.questions?.[0] || ""}\n  - Q (Jp): ${faq.questionJp || ""}\n  - Expert Guidance & Answer: ${faq.expertGuidance || faq.answerHtml || ""}`
      )
      .join("\n\n");
  } else {
    faqKnowledgeBankText = "  * No specific FAQ database items passed for this session.";
  }

  const isFinalStr = typeof isFinalTurn === "boolean" ? (isFinalTurn ? "true" : "false") : String(isFinalTurn);
  const requestVisualAidStr = typeof requestVisualAid === "boolean" ? (requestVisualAid ? "true" : "false") : String(requestVisualAid);

  // 4. 個別の固有コンテキストと、共通ファンデーションプロンプトを結合
  const combinedPrompt = `
${specificContext}

${AIYAMATO_FoundationLayout_PROMPT}
`.trim();

  // 5. すべてのプレースホルダーを置換して返却
  return combinedPrompt
    .replace("__STUDENT_EMAIL__", studentEmail)
    .replace("__USER_ID__", userId)
    .replace("__USER_NICKNAME__", userNickname)
    .replace("__LEARNING_PACE__", String(learningPace))
    .replace("__PRACTICE_MODE__", String(practiceMode))
    .replace("__SEC1_TOPIC__", String(sec1Topic))
    .replace("__TURN_COUNT__", String(turnCount))
    .replace("__CURRENT_TURN__", String(currentTurn))
    .replace("__IS_FINAL_TURN__", isFinalStr)
    .replace("__ATTACHED_FILES__", attachedFiles)
    .replace("__REQUEST_VISUAL_AID__", requestVisualAidStr)
    .replace("__TIME_CONTEXT__", timeContext)
    .replace("__WEATHER_CONTEXT__", weatherContext)
    .replace("__FAQ_KNOWLEDGE_BANK__", faqKnowledgeBankText);
}

export default AIYAMATO_FoundationLayout_PROMPT;