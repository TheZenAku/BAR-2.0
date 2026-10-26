import { ApiErrorResponse, HealthResponse, PROTOCOL_VERSION, ReadinessResponse, SessionResponse } from '@bar/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.ts';
import { createLogger } from '../logger.ts';
import {
  call,
  createTestContext,
  MemoryMailer,
  newAccount,
  ORIGIN,
  TEST_CONFIG,
  type TestContext,
  testDb,
} from '../testing/harness.ts';
import { DEFAULT_RATE_LIMITS } from './rate-limit.ts';

const V1 = '/api/v1';
const err = (body: unknown) => ApiErrorResponse.parse(body).error;

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(() => ctx.close());

const register = async (acc = newAccount()) => {
  const res = await call(ctx, 'POST', `${V1}/auth/register`, { body: acc });
  expect(res.status, res.raw).toBe(201);
  return { ...acc, token: res.sessionToken!, user: SessionResponse.parse(res.body).user };
};

describe('input validation', () => {
  it('rejects invalid payloads with 400 and field paths, never echoing values', async () => {
    const cases: unknown[] = [
      {},
      { email: 'not-an-email', password: 'long enough password', displayName: 'Ana' },
      { email: 'a@example.com', password: 'short', displayName: 'Ana' },
      { email: 'a@example.com', password: 'long enough password', displayName: '<b>x</b>' },
      { email: 'a@example.com', password: 'long enough password', displayName: 'Ana', role: 'admin' },
      { email: 'a@example.com', password: 'x'.repeat(200), displayName: 'Ana' },
      [],
      'string',
    ];
    for (const body of cases) {
      const res = await call(ctx, 'POST', `${V1}/auth/register`, { body });
      expect(res.status, JSON.stringify(body)).toBe(400);
      const e = err(res.body);
      expect(e.code).toBe('invalid_request');
      expect(e.requestId).toBe(res.headers['x-request-id']);
      expect(res.raw).not.toContain('long enough password');
      expect(res.raw).not.toContain('not-an-email');
    }
    const res = await call(ctx, 'POST', `${V1}/auth/register`, { body: { email: 'bad' } });
    expect(err(res.body).issues?.map((i) => i.path)).toEqual(expect.arrayContaining(['email', 'password']));
  });

  it('malformed JSON, prototype pollution and oversized bodies are rejected cleanly', async () => {
    expect((await call(ctx, 'POST', `${V1}/auth/login`, { body: '{"email":' })).status).toBe(400);
    const proto = await call(ctx, 'POST', `${V1}/auth/login`, {
      body: '{"email":"a@example.com","password":"x","__proto__":{"admin":true}}',
    });
    expect(proto.status).toBe(400);
    const big = await call(ctx, 'POST', `${V1}/auth/login`, {
      body: { email: 'a@example.com', password: 'x'.repeat(20_000) },
    });
    expect(big.status).toBe(413);
    expect(err(big.body).code).toBe('payload_too_large');
  });

  it('SQL metacharacters are data, not code', async () => {
    const res = await call(ctx, 'POST', `${V1}/auth/login`, {
      body: { email: "x'or'1'='1@example.com", password: "' OR 1=1; DROP TABLE users; --" },
    });
    expect([400, 401]).toContain(res.status);
    await register(); // table still there
  });
});

describe('credentials and enumeration', () => {
  it('wrong password and unknown account produce identical responses', async () => {
    const a = await register();
    const wrong = await call(ctx, 'POST', `${V1}/auth/login`, {
      body: { email: a.email, password: 'wrong password!' },
    });
    const unknown = await call(ctx, 'POST', `${V1}/auth/login`, {
      body: { email: 'nobody-here@example.com', password: 'wrong password!' },
    });
    for (const r of [wrong, unknown]) {
      expect(r.status).toBe(401);
      expect(r.sessionToken).toBeUndefined();
    }
    const strip = (b: unknown) => ({ ...err(b), requestId: undefined });
    expect(strip(wrong.body)).toEqual(strip(unknown.body));
    expect(err(wrong.body).code).toBe('invalid_credentials');
  });

  it('unknown accounts still pay the Argon2 cost (timing does not reveal existence)', async () => {
    const a = await register();
    const time = async (email: string) => {
      const t = performance.now();
      await call(ctx, 'POST', `${V1}/auth/login`, { body: { email, password: 'wrong password!' } });
      return performance.now() - t;
    };
    await time('warmup@example.com');
    const median = async (email: string) => {
      const xs = [];
      for (let i = 0; i < 5; i++) xs.push(await time(email));
      return xs.sort((x, y) => x - y)[2]!;
    };
    const known = await median(a.email);
    const unknown = await median('ghost@example.com');
    // Coarse bound: both pay one Argon2id derivation (tens of ms); a short-circuit would be ~10× faster.
    expect(unknown).toBeGreaterThan(known * 0.4);
  });

  it('recovery requests answer 202 with an empty body whether or not the account exists', async () => {
    const a = await register();
    const before = ctx.mailer.sent.length;
    const known = await call(ctx, 'POST', `${V1}/auth/recovery`, { body: { email: a.email } });
    const unknown = await call(ctx, 'POST', `${V1}/auth/recovery`, { body: { email: 'ghost@example.com' } });
    expect([known.status, unknown.status]).toEqual([202, 202]);
    expect([known.raw, unknown.raw]).toEqual(['', '']);
    await new Promise((r) => setTimeout(r, 20)); // delivery is asynchronous
    expect(ctx.mailer.sent.length - before).toBe(1);
    expect(ctx.mailer.sent.at(-1)!.to).toBe(a.email);
  });

  it('random recovery tokens are rejected', async () => {
    const res = await call(ctx, 'POST', `${V1}/auth/recovery/confirm`, {
      body: { token: 'A'.repeat(43), newPassword: 'some new password' },
    });
    expect(res.status).toBe(400);
    expect(err(res.body).code).toBe('invalid_token');
  });
});

describe('authorization', () => {
  it('protected endpoints require a session', async () => {
    const someone = await register();
    for (const [method, url] of [
      ['GET', `${V1}/auth/session`],
      ['GET', `${V1}/users/${someone.user.id}`],
      ['DELETE', `${V1}/account`],
    ] as const) {
      const res = await call(ctx, method, url, { body: { password: 'x' } });
      expect(res.status, `${method} ${url}`).toBe(401);
      expect(err(res.body).code).toBe('unauthenticated');
    }
  });

  it("other players' profiles expose only public fields; the session always resolves to its owner", async () => {
    const a = await register();
    const b = await register();
    const profile = await call(ctx, 'GET', `${V1}/users/${b.user.id}`, { token: a.token });
    expect(profile.status).toBe(200);
    expect(SessionResponse.parse(profile.body).user).toEqual(b.user);
    expect(profile.raw).not.toContain(b.email);
    expect(profile.raw).not.toMatch(/argon2|password|email/i);

    const me = await call(ctx, 'GET', `${V1}/auth/session`, { token: a.token });
    expect(SessionResponse.parse(me.body).user.id).toBe(a.user.id);
    // A's deletion request with B's password must not delete anything (it targets A only).
    const cross = await call(ctx, 'DELETE', `${V1}/account`, { token: a.token, body: { password: b.password } });
    expect(cross.status).toBe(401);
    expect((await call(ctx, 'GET', `${V1}/auth/session`, { token: b.token })).status).toBe(200);
    expect((await call(ctx, 'GET', `${V1}/auth/session`, { token: a.token })).status).toBe(200);
  });

  it('unknown and malformed public ids', async () => {
    const a = await register();
    const missing = await call(ctx, 'GET', `${V1}/users/00000000-0000-4000-8000-000000000000`, { token: a.token });
    expect(missing.status).toBe(404);
    const bad = await call(ctx, 'GET', `${V1}/users/1`, { token: a.token });
    expect(bad.status).toBe(400);
  });
});

describe('CSRF', () => {
  it('blocks state-changing requests from foreign origins, with or without a session', async () => {
    const a = await register();
    for (const origin of ['https://evil.example', 'null', `${ORIGIN}.evil.test`]) {
      const res = await call(ctx, 'POST', `${V1}/auth/logout`, { token: a.token, headers: { origin } });
      expect(res.status, origin).toBe(403);
      expect(err(res.body).code).toBe('forbidden_origin');
    }
    const del = await call(ctx, 'DELETE', `${V1}/account`, {
      token: a.token,
      body: { password: a.password },
      headers: { origin: 'https://evil.example' },
    });
    expect(del.status).toBe(403);
    expect((await call(ctx, 'GET', `${V1}/auth/session`, { token: a.token })).status).toBe(200);
  });

  it('blocks HTML-form content types and cross-site fetch metadata', async () => {
    const a = await register();
    const form = await call(ctx, 'POST', `${V1}/auth/logout`, {
      token: a.token,
      body: 'x=1',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(form.status).toBe(415);
    const res = await call(ctx, 'POST', `${V1}/auth/logout`, {
      token: a.token,
      headers: { origin: '', 'sec-fetch-site': 'cross-site' },
    });
    expect(res.status).toBe(403);
    expect((await call(ctx, 'GET', `${V1}/auth/session`, { token: a.token })).status).toBe(200);
  });
});

describe('rate limiting (production limits)', () => {
  let limited: TestContext;
  beforeAll(async () => {
    limited = await createTestContext({ rateLimits: DEFAULT_RATE_LIMITS });
  });
  afterAll(() => limited.close());

  it('login: per-account limit, with Retry-After, applies even to correct passwords', async () => {
    const acc = newAccount();
    expect((await call(limited, 'POST', `${V1}/auth/register`, { body: acc })).status).toBe(201);
    const max = DEFAULT_RATE_LIMITS.login.perEmail!.limit;
    for (let i = 0; i < max; i++) {
      const r = await call(limited, 'POST', `${V1}/auth/login`, {
        body: { email: acc.email, password: 'wrong guess!' },
      });
      expect(r.status).toBe(401);
    }
    const blocked = await call(limited, 'POST', `${V1}/auth/login`, {
      body: { email: acc.email, password: acc.password },
    });
    expect(blocked.status).toBe(429);
    expect(err(blocked.body).code).toBe('rate_limited');
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('register: per-IP limit', async () => {
    const max = DEFAULT_RATE_LIMITS.register.perIp.limit;
    const statuses = [];
    for (let i = 0; i < max + 1; i++) {
      statuses.push((await call(limited, 'POST', `${V1}/auth/register`, { body: newAccount() })).status);
    }
    // One registration already happened in the previous test from the same IP.
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThanOrEqual(2);
    expect(statuses.at(-1)).toBe(429);
  });

  it('recovery: per-account limit', async () => {
    const max = DEFAULT_RATE_LIMITS.recoveryRequest.perEmail!.limit;
    const statuses = [];
    for (let i = 0; i < max + 1; i++) {
      statuses.push(
        (await call(limited, 'POST', `${V1}/auth/recovery`, { body: { email: 'target@example.com' } })).status,
      );
    }
    expect(statuses).toEqual([...Array(max).fill(202), 429]);
  });
});

describe('cookies in secure mode', () => {
  it('uses the __Host- prefix with Secure, HttpOnly, SameSite=Lax and Path=/', async () => {
    const secure = await createTestContext({ config: { COOKIE_SECURE: true } });
    try {
      const res = await call(secure, 'POST', `${V1}/auth/register`, { body: newAccount() });
      expect(res.status).toBe(201);
      const c = res.setCookie.join(';');
      expect(c).toMatch(/^__Host-bar_sid=/);
      for (const attr of [/Secure/, /HttpOnly/i, /SameSite=Lax/i, /Path=\//]) expect(c).toMatch(attr);
      expect(c).not.toMatch(/Domain=/i);
    } finally {
      await secure.close();
    }
  });
});

describe('no data leakage', () => {
  it('logs never contain passwords, e-mails, session or recovery tokens', async () => {
    const acc = newAccount('leak');
    const reg = await call(ctx, 'POST', `${V1}/auth/register`, { body: acc });
    await call(ctx, 'GET', `${V1}/auth/session`, { token: reg.sessionToken });
    await call(ctx, 'POST', `${V1}/auth/login`, { body: { email: acc.email, password: acc.password } });
    await call(ctx, 'POST', `${V1}/auth/login`, { body: { email: acc.email, password: 'a wrong password' } });
    await call(ctx, 'POST', `${V1}/auth/recovery`, { body: { email: acc.email } });
    await new Promise((r) => setTimeout(r, 20));
    const resetToken = ctx.mailer.tokenFor(acc.email);
    await call(ctx, 'POST', `${V1}/auth/recovery/confirm`, {
      body: { token: resetToken, newPassword: 'the new secret pw' },
    });
    const logs = ctx.logs.join('\n');
    expect(logs.length).toBeGreaterThan(0);
    expect(logs).toContain('"reqId"'); // correlation id on request logs
    for (const secret of [
      acc.password,
      acc.email,
      reg.sessionToken!,
      resetToken,
      'a wrong password',
      'the new secret pw',
    ]) {
      expect(logs).not.toContain(secret);
    }
  });

  it('error responses carry a request id and no stack traces or SQL', async () => {
    const res = await call(ctx, 'GET', `${V1}/nope`);
    expect(res.status).toBe(404);
    expect(err(res.body)).toEqual({ code: 'not_found', message: 'Not found', requestId: res.headers['x-request-id'] });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cache-control']).toBe('no-store');
  });
});

describe('health, readiness and database outage', () => {
  it('/health is a liveness probe; /ready checks PostgreSQL', async () => {
    const health = await call(ctx, 'GET', '/health');
    expect(HealthResponse.parse(health.body).protocol).toBe(PROTOCOL_VERSION);
    const ready = await call(ctx, 'GET', '/ready');
    expect(ready.status).toBe(200);
    expect(ReadinessResponse.parse(ready.body)).toEqual({ status: 'ready', checks: { database: 'up' } });
  });

  it('with the database down: 503 service_unavailable, readiness fails, liveness still answers', async () => {
    const logs: string[] = [];
    const logger = createLogger({ LOG_LEVEL: 'info' }, { write: (l: string) => void logs.push(l) });
    const db = testDb('postgres://bar:x@127.0.0.1:1/none', logger);
    const app = buildApp({ config: TEST_CONFIG, db, logger, mailer: new MemoryMailer(), version: 'test' });
    try {
      const login = await call({ app }, 'POST', `${V1}/auth/login`, {
        body: { email: 'a@example.com', password: 'whatever pw' },
      });
      expect(login.status).toBe(503);
      expect(err(login.body).code).toBe('service_unavailable');
      const ready = await call({ app }, 'GET', '/ready');
      expect(ready.status).toBe(503);
      expect(ReadinessResponse.parse(ready.body).checks.database).toBe('down');
      expect((await call({ app }, 'GET', '/health')).status).toBe(200);
      expect(logs.join('\n')).not.toContain('bar:x@'); // connection string never logged
    } finally {
      await app.close();
      await db.destroy();
    }
  });

  it('draining turns readiness off before shutdown', async () => {
    const app = buildApp({
      config: TEST_CONFIG,
      db: ctx.db,
      logger: createLogger({ LOG_LEVEL: 'silent' }),
      mailer: new MemoryMailer(),
      version: 'test',
    });
    try {
      expect((await call({ app }, 'GET', '/ready')).status).toBe(200);
      app.startDraining();
      expect((await call({ app }, 'GET', '/ready')).status).toBe(503);
    } finally {
      await app.close();
    }
  });
});
