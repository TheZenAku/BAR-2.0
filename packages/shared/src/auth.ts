import { z } from 'zod';

/**
 * HTTP API version prefix. Breaking changes go to a new prefix (`/api/v2`) while the previous one is kept for at least
 * one client release. Compatibility policy: the server rejects unknown input fields (strict requests); the client
 * ignores unknown response fields (tolerant reader), so additive server changes never break deployed clients.
 */
export const API_PREFIX = '/api/v1';

export const EMAIL_MAX = 254;
export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;
export const DISPLAY_NAME_MIN = 3;
export const DISPLAY_NAME_MAX = 20;

const codePoints = (s: string): number => [...s].length;

/** Login identifier. Normalized: NFC, trimmed, lowercased. Private: never returned by the API. */
export const Email = z
  .string()
  .max(EMAIL_MAX * 2)
  .transform((s) => s.normalize('NFC').trim().toLowerCase())
  .pipe(z.email().max(EMAIL_MAX));

/** New password. Length-only policy (no composition rules); counted in code points, so ≤ 512 UTF-8 bytes. */
export const Password = z
  .string()
  .refine((s) => codePoints(s) >= PASSWORD_MIN, `mínimo de ${PASSWORD_MIN} caracteres`)
  .refine((s) => codePoints(s) <= PASSWORD_MAX, `máximo de ${PASSWORD_MAX} caracteres`);

/** Password presented for verification. Not checked against the current policy, only bounded. */
export const PasswordAttempt = z
  .string()
  .min(1)
  .max(PASSWORD_MAX * 4);

// Letters (with combining marks) and digits; inner spaces, '.', '_' and '-' allowed. No control or invisible characters.
const DISPLAY_NAME_RE = /^[\p{L}\p{N}][\p{L}\p{M}\p{N} ._-]*$/u;

/** Public, non-unique display name. Normalized: NFC, trimmed, inner whitespace collapsed. */
export const DisplayName = z
  .string()
  .max(DISPLAY_NAME_MAX * 4)
  .transform((s) => s.normalize('NFC').trim().replace(/\s+/gu, ' '))
  .refine(
    (s) => codePoints(s) >= DISPLAY_NAME_MIN && codePoints(s) <= DISPLAY_NAME_MAX,
    `entre ${DISPLAY_NAME_MIN} e ${DISPLAY_NAME_MAX} caracteres`,
  )
  .refine((s) => DISPLAY_NAME_RE.test(s), 'use letras, números, espaço, ".", "_" ou "-"');

/** Stable public identifier (random UUID); internal numeric ids never leave the server. */
export const PublicId = z.uuid();

/** 32 random bytes, base64url without padding. */
export const OpaqueToken = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export const RegisterRequest = z.strictObject({ email: Email, password: Password, displayName: DisplayName });
export type RegisterRequest = z.input<typeof RegisterRequest>;

export const LoginRequest = z.strictObject({ email: Email, password: PasswordAttempt });
export type LoginRequest = z.input<typeof LoginRequest>;

export const RecoveryRequest = z.strictObject({ email: Email });
export type RecoveryRequest = z.input<typeof RecoveryRequest>;

export const RecoveryConfirmRequest = z.strictObject({ token: OpaqueToken, newPassword: Password });
export type RecoveryConfirmRequest = z.input<typeof RecoveryConfirmRequest>;

export const DeleteAccountRequest = z.strictObject({ password: PasswordAttempt });
export type DeleteAccountRequest = z.input<typeof DeleteAccountRequest>;

/** Everything other players may see about an account. */
export const PublicUser = z.object({
  id: PublicId,
  displayName: z.string(),
  createdAt: z.iso.datetime({ offset: true }),
});
export type PublicUser = z.infer<typeof PublicUser>;

export const SessionResponse = z.object({ user: PublicUser });
export type SessionResponse = z.infer<typeof SessionResponse>;

export const ErrorCode = z.enum([
  'invalid_request',
  'unsupported_media_type',
  'payload_too_large',
  'invalid_credentials',
  'unauthenticated',
  'email_unavailable',
  'invalid_token',
  'forbidden_origin',
  'not_found',
  'rate_limited',
  'room_full',
  'service_unavailable',
  'internal_error',
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

/** Body of every non-2xx API response. `message` is a stable English hint; clients localize by `code`. */
export const ApiErrorResponse = z.object({
  error: z.object({
    code: ErrorCode,
    message: z.string(),
    requestId: z.string().optional(),
    issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  }),
});
export type ApiErrorResponse = z.infer<typeof ApiErrorResponse>;

/** Response of `GET /ready`: 200 when every dependency answers, 503 otherwise. */
export const ReadinessResponse = z.strictObject({
  status: z.enum(['ready', 'unavailable']),
  checks: z.strictObject({ database: z.enum(['up', 'down']) }),
});
export type ReadinessResponse = z.infer<typeof ReadinessResponse>;
