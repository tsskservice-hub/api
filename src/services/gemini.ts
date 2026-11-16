/**
 * @file src/services/gemini.ts
 * @description Gemini 2.5 Flash（Vertex AI）を 1 回呼んで、文字の答えを返す小さな道具
 */
import { getGoogleAccessToken } from './google-auth';

export interface GeminiCallOptions {
  system: string;
  contents: { role: 'user' | 'model'; text: string; image?: { mimeType: string; base64: string } }[];
  temperature?: number;
  maxOutputTokens?: number;
  /** 考える時間（0 = 考えない。速い・安い）。省略するとモデルにまかせる */
  thinkingBudget?: number;
  /** JSON で返してほしいとき */
  json?: boolean;
  /** この時間（ミリ秒）で返事がなければやめる */
  timeoutMs?: number;
}

export async function callGemini(env: any, options: GeminiCallOptions): Promise<string> {
  const serviceAccountKey = env.VERTEX_AI_KEY || env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const projectId = env.VERTEX_AI_PROJECT_ID;
  const region = env.VERTEX_AI_REGION || 'us-central1';
  if (!serviceAccountKey || !projectId) throw new Error('Vertex AI is not configured');

  const accessToken = await getGoogleAccessToken(serviceAccountKey);
  const url =
    'https://' + region + '-aiplatform.' + ['google', 'apis'].join('') + '.com/v1/projects/' + projectId +
    '/locations/' + region + '/publishers/google/models/gemini-2.5-flash:generateContent';

  const generationConfig: Record<string, unknown> = {
    temperature: options.temperature ?? 0.7,
    maxOutputTokens: options.maxOutputTokens ?? 1024,
  };
  if (options.thinkingBudget !== undefined) generationConfig.thinkingConfig = { thinkingBudget: options.thinkingBudget };
  if (options.json) generationConfig.responseMimeType = 'application/json';

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + accessToken },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: options.system }] },
      contents: options.contents.map((c) => ({
        role: c.role,
        parts: [
          ...(c.image ? [{ inlineData: { mimeType: c.image.mimeType, data: c.image.base64 } }] : []),
          { text: c.text },
        ],
      })),
      generationConfig,
    }),
    ...(options.timeoutMs ? { signal: AbortSignal.timeout(options.timeoutMs) } : {}),
  });
  if (!res.ok) throw new Error(`Vertex ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as any;
  const parts = data?.candidates?.[0]?.content?.parts || [];
  // 考えた内容（thought）は除いて、答えの文だけをつなげる
  return parts
    .filter((p: any) => !p.thought)
    .map((p: any) => p.text || '')
    .join('')
    .trim();
}
