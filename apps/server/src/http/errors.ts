import type { ApiErrorResponse, ErrorCode } from '@bar/shared';
import type { z } from 'zod';

type Issue = { path: string; message: string };

/** Expected, client-facing failure. Anything else thrown in a handler becomes a logged 500. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly issues: Issue[] | undefined;
  readonly headers: Record<string, string> | undefined;

  constructor(
    status: number,
    code: ErrorCode,
    message: string,
    extra?: { issues?: Issue[]; headers?: Record<string, string> },
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.issues = extra?.issues;
    this.headers = extra?.headers;
  }
}

export const unauthenticated = (): ApiError => new ApiError(401, 'unauthenticated', 'Authentication required');
export const invalidCredentials = (): ApiError => new ApiError(401, 'invalid_credentials', 'Invalid email or password');

export function errorBody(code: ErrorCode, message: string, requestId: string, issues?: Issue[]): ApiErrorResponse {
  return { error: { code, message, requestId, ...(issues ? { issues } : {}) } };
}

/** Validates untrusted input. Issues carry paths and generic messages only — never the submitted values. */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const issues = result.error.issues.map((i) => ({ path: i.path.join('.') || '(body)', message: i.message }));
  throw new ApiError(400, 'invalid_request', 'Request validation failed', { issues });
}
