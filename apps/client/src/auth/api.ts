import {
  API_PREFIX,
  ApiErrorResponse,
  type ErrorCode,
  type LoginRequest,
  type PublicUser,
  type RecoveryConfirmRequest,
  type RegisterRequest,
  SessionResponse,
} from '@bar/shared';

export type ClientErrorCode = ErrorCode | 'network_error' | 'bad_response';

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: ClientErrorCode; status: number; retryAfterSeconds?: number };

/**
 * Typed client for the auth API (v1). The session lives in an HttpOnly cookie the page cannot read; requests are
 * same-origin (Vite proxies /api in dev). Responses are parsed with the shared schemas as tolerant readers.
 * Never throws.
 */
export class AuthApi {
  private readonly fetchFn: typeof fetch;

  constructor(fetchFn: typeof fetch = (input, init) => fetch(input, init)) {
    this.fetchFn = fetchFn;
  }

  session(): Promise<ApiResult<PublicUser>> {
    return this.request('GET', '/auth/session', undefined, (b) => SessionResponse.parse(b).user);
  }

  register(input: RegisterRequest): Promise<ApiResult<PublicUser>> {
    return this.request('POST', '/auth/register', input, (b) => SessionResponse.parse(b).user);
  }

  login(input: LoginRequest): Promise<ApiResult<PublicUser>> {
    return this.request('POST', '/auth/login', input, (b) => SessionResponse.parse(b).user);
  }

  logout(): Promise<ApiResult<undefined>> {
    return this.request('POST', '/auth/logout', {}, () => undefined);
  }

  requestRecovery(email: string): Promise<ApiResult<undefined>> {
    return this.request('POST', '/auth/recovery', { email }, () => undefined);
  }

  confirmRecovery(input: RecoveryConfirmRequest): Promise<ApiResult<undefined>> {
    return this.request('POST', '/auth/recovery/confirm', input, () => undefined);
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body: unknown,
    parse: (body: unknown) => T,
  ): Promise<ApiResult<T>> {
    let res: Response;
    try {
      res = await this.fetchFn(`${API_PREFIX}${path}`, {
        method,
        credentials: 'same-origin',
        headers: { accept: 'application/json', ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      return { ok: false, code: 'network_error', status: 0 };
    }
    const text = await res.text().catch(() => '');
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    if (res.ok) {
      try {
        return { ok: true, data: parse(json) };
      } catch {
        return { ok: false, code: 'bad_response', status: res.status };
      }
    }
    const err = ApiErrorResponse.safeParse(json);
    const retry = Number(res.headers.get('retry-after'));
    return {
      ok: false,
      code: err.success ? err.data.error.code : res.status >= 500 ? 'service_unavailable' : 'bad_response',
      status: res.status,
      ...(retry > 0 ? { retryAfterSeconds: retry } : {}),
    };
  }
}

/** User-facing message (pt-BR) for an error code. Deliberately generic for credential errors. */
export function errorMessage(code: ClientErrorCode, retryAfterSeconds?: number): string {
  switch (code) {
    case 'invalid_credentials':
      return 'E-mail ou senha incorretos.';
    case 'email_unavailable':
      return 'Não foi possível criar a conta com este e-mail. Se ele já é seu, entre ou recupere a senha.';
    case 'room_full':
      return 'A sala está cheia. Tente novamente em instantes.';
    case 'invalid_token':
      return 'Link de recuperação inválido ou expirado. Peça um novo.';
    case 'rate_limited': {
      const minutes = retryAfterSeconds ? Math.ceil(retryAfterSeconds / 60) : undefined;
      return `Muitas tentativas. Tente novamente${minutes ? ` em ${minutes} min` : ' mais tarde'}.`;
    }
    case 'invalid_request':
      return 'Verifique os campos e tente novamente.';
    case 'unauthenticated':
      return 'Sua sessão expirou. Entre novamente.';
    case 'network_error':
      return 'Sem conexão com o servidor. Verifique sua rede e tente novamente.';
    case 'service_unavailable':
      return 'Servidor temporariamente indisponível. Tente novamente em instantes.';
    default:
      return 'Algo deu errado. Tente novamente.';
  }
}
