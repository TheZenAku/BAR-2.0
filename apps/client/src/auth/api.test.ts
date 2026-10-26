import { describe, expect, it } from 'vitest';
import { AuthApi, errorMessage } from './api.ts';

const user = { id: '0b8f1c1e-3a51-4d1a-9a3e-1b2c3d4e5f60', displayName: 'Ana', createdAt: '2026-10-26T12:00:00.000Z' };
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers });

function recorder(response: Response | (() => never)) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return typeof response === 'function' ? response() : response;
  }) as typeof fetch;
  return { api: new AuthApi(fetchFn), calls };
}

describe('AuthApi', () => {
  it('posts JSON to the versioned API with same-origin credentials', async () => {
    const { api, calls } = recorder(json({ user }, 201));
    const res = await api.register({ email: 'a@example.com', password: 'long password', displayName: 'Ana' });
    expect(res).toEqual({ ok: true, data: user });
    expect(calls[0]!.url).toBe('/api/v1/auth/register');
    expect(calls[0]!.init.method).toBe('POST');
    expect(calls[0]!.init.credentials).toBe('same-origin');
    expect((calls[0]!.init.headers as Record<string, string>)['content-type']).toBe('application/json');
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({ displayName: 'Ana' });
  });

  it('logout sends an empty JSON object (the server requires JSON on state changes)', async () => {
    const { api, calls } = recorder(new Response(null, { status: 204 }));
    expect(await api.logout()).toEqual({ ok: true, data: undefined });
    expect(calls[0]!.init.body).toBe('{}');
  });

  it('ignores unknown response fields (tolerant reader)', async () => {
    const { api } = recorder(json({ user: { ...user, futureField: 1 }, extra: true }));
    expect(await api.session()).toEqual({ ok: true, data: user });
  });

  it('maps API errors, rate limits, network failures and bad payloads without throwing', async () => {
    expect(await recorder(json({ error: { code: 'unauthenticated', message: 'x' } }, 401)).api.session()).toEqual({
      ok: false,
      code: 'unauthenticated',
      status: 401,
    });
    const limited = await recorder(
      json({ error: { code: 'rate_limited', message: 'x' } }, 429, { 'retry-after': '120' }),
    ).api.login({ email: 'a@example.com', password: 'x' });
    expect(limited).toEqual({ ok: false, code: 'rate_limited', status: 429, retryAfterSeconds: 120 });
    const offline = await recorder(() => {
      throw new TypeError('network');
    }).api.session();
    expect(offline).toEqual({ ok: false, code: 'network_error', status: 0 });
    expect(await recorder(json({ user: { id: 1 } })).api.session()).toMatchObject({ ok: false, code: 'bad_response' });
    expect(await recorder(new Response('<html>', { status: 502 })).api.session()).toMatchObject({
      ok: false,
      code: 'service_unavailable',
    });
  });
});

describe('errorMessage', () => {
  it('is generic for credential errors and actionable for rate limits', () => {
    expect(errorMessage('invalid_credentials')).toBe('E-mail ou senha incorretos.');
    expect(errorMessage('rate_limited', 90)).toContain('2 min');
    expect(errorMessage('internal_error')).toBe('Algo deu errado. Tente novamente.');
  });
});
