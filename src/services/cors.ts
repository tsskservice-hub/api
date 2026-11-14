/**
 * @file src/services/cors.ts
 * @description この API を呼んでよいサイト（Origin）の許可リスト（CORS）
 *
 * 許可するのは次の3種類だけ。文字列の「含む／で終わる」ではなく、完全一致または正規表現で判定する。
 *   - 本番:       https://jptutoraiyamato.com / https://www.jptutoraiyamato.com
 *   - プレビュー: https://<任意>.yamato-portal-3wv.pages.dev（このサイトの Cloudflare Pages だけ）
 *   - 開発:       http://localhost:<port> / http://127.0.0.1:<port>
 * これ以外（例: evil-jptutoraiyamato.com、だれかの xxx.pages.dev）には CORS ヘッダーを返さない。
 */

const ALLOWED_ORIGINS = new Set([
  'https://jptutoraiyamato.com',
  'https://www.jptutoraiyamato.com',
  'https://yamato-portal-3wv.pages.dev',
]);

const ALLOWED_ORIGIN_PATTERNS = [
  /^https:\/\/[a-z0-9-]+\.yamato-portal-3wv\.pages\.dev$/,
  /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/,
];

/** 許可されたサイトなら、そのまま Origin を返す。許可されていなければ null */
export function getAllowedOrigin(origin: string | null | undefined): string | null {
  if (!origin) return null;
  if (ALLOWED_ORIGINS.has(origin)) return origin;
  if (ALLOWED_ORIGIN_PATTERNS.some((re) => re.test(origin))) return origin;
  return null;
}

/** Response に直接付ける CORS ヘッダー（許可されていないサイトには何も付けない） */
export function corsHeadersFor(origin: string | null | undefined): Record<string, string> {
  const allowed = getAllowedOrigin(origin);
  if (!allowed) return {};
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Credentials': 'true',
    Vary: 'Origin',
  };
}
