import { ApiError } from './errors.ts';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

type Headers = Record<string, string | string[] | undefined>;

/**
 * CSRF defense for cookie-authenticated, state-changing requests (OWASP: Origin verification + Fetch Metadata),
 * layered on top of SameSite=Lax cookies:
 * - `Content-Type: application/json` is required, so HTML forms (urlencoded/multipart/text) can never reach a handler,
 *   and cross-origin `fetch` with JSON needs a CORS preflight, which this server never grants.
 * - Browsers send `Origin` on every non-GET request; it must be in the allowlist.
 * - Without `Origin` (non-browser clients cannot carry a victim's cookies), `Sec-Fetch-Site`, when present, must be
 *   same-origin.
 * Throws ApiError; returns normally when the request may proceed.
 */
export function assertTrustedOrigin(method: string, headers: Headers, allowedOrigins: ReadonlySet<string>): void {
  if (SAFE_METHODS.has(method)) return;
  const contentType = String(headers['content-type'] ?? '')
    .split(';')[0]!
    .trim()
    .toLowerCase();
  if (contentType !== 'application/json') {
    throw new ApiError(415, 'unsupported_media_type', 'Content-Type must be application/json');
  }
  const origin = headers.origin;
  if (origin !== undefined) {
    if (typeof origin !== 'string' || !allowedOrigins.has(origin)) {
      throw new ApiError(403, 'forbidden_origin', 'Origin not allowed');
    }
    return;
  }
  const site = headers['sec-fetch-site'];
  if (site !== undefined && site !== 'same-origin') {
    throw new ApiError(403, 'forbidden_origin', 'Cross-site request blocked');
  }
}
