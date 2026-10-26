import { ApiErrorResponse, SessionResponse } from '@bar/shared';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.ts';
import { createLogger } from '../logger.ts';
import {
  call,
  createTestContext,
  MemoryMailer,
  newAccount,
  TEST_CONFIG,
  type TestContext,
} from '../testing/harness.ts';
import { hashToken } from './tokens.ts';

const V1 = '/api/v1';

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
const errorCode = (body: unknown) => ApiErrorResponse.parse(body).error.code;

describe('register → session → logout → login', () => {
  it('creates the account, sets an HttpOnly session cookie and returns only public data', async () => {
    const acc = newAccount();
    const res = await call(ctx, 'POST', `${V1}/auth/register`, {
      body: { ...acc, email: `  ${acc.email.toUpperCase()} `, displayName: '  Ana   Maria ' },
    });
    expect(res.status).toBe(201);
    const { user } = SessionResponse.parse(res.body);
    expect(user.displayName).toBe('Ana Maria');
    expect(Object.keys(res.body as object)).toEqual(['user']);
    expect(Object.keys(user).sort()).toEqual(['createdAt', 'displayName', 'id']);
    expect(res.raw).not.toContain(acc.email);
    expect(res.sessionToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const cookie = res.setCookie.join(';');
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\//);

    const row = await ctx.db.selectFrom('users').selectAll().where('public_id', '=', user.id).executeTakeFirstOrThrow();
    expect(row.email).toBe(acc.email); // normalized
    expect(row.password_hash).toMatch(/^\$argon2id\$/);
    expect(row.password_hash).not.toContain(acc.password);
    const session = await ctx.db
      .selectFrom('sessions')
      .selectAll()
      .where('user_id', '=', row.id)
      .executeTakeFirstOrThrow();
    expect(session.token_hash.equals(hashToken(res.sessionToken!))).toBe(true); // only the hash is stored
  });

  it('GET /auth/session returns the authenticated user; logout revokes it server-side', async () => {
    const a = await register();
    const me = await call(ctx, 'GET', `${V1}/auth/session`, { token: a.token });
    expect(me.status).toBe(200);
    expect(SessionResponse.parse(me.body).user).toEqual(a.user);

    const out = await call(ctx, 'POST', `${V1}/auth/logout`, { token: a.token });
    expect(out.status).toBe(204);
    expect(out.sessionToken).toBe(''); // cookie cleared
    expect(out.setCookie.join(';')).toMatch(/Expires=Thu, 01 Jan 1970|Max-Age=0/i);

    // Replaying the old cookie must fail: revocation is server-side, not just a cleared cookie.
    const replay = await call(ctx, 'GET', `${V1}/auth/session`, { token: a.token });
    expect(replay.status).toBe(401);
    expect(errorCode(replay.body)).toBe('unauthenticated');
    // Logout is idempotent.
    expect((await call(ctx, 'POST', `${V1}/auth/logout`, { token: a.token })).status).toBe(204);
    expect((await call(ctx, 'POST', `${V1}/auth/logout`)).status).toBe(204);
  });

  it('login verifies the hash, accepts any e-mail casing and issues a fresh session', async () => {
    const a = await register();
    const res = await call(ctx, 'POST', `${V1}/auth/login`, {
      body: { email: a.email.toUpperCase(), password: a.password },
    });
    expect(res.status).toBe(200);
    expect(SessionResponse.parse(res.body).user).toEqual(a.user);
    expect(res.sessionToken).toBeDefined();
    expect(res.sessionToken).not.toBe(a.token);
    expect((await call(ctx, 'GET', `${V1}/auth/session`, { token: res.sessionToken })).status).toBe(200);
  });

  it('login rotates the session presented with the request (no fixation)', async () => {
    const a = await register();
    const res = await call(ctx, 'POST', `${V1}/auth/login`, {
      body: { email: a.email, password: a.password },
      token: a.token,
    });
    expect(res.status).toBe(200);
    expect((await call(ctx, 'GET', `${V1}/auth/session`, { token: a.token })).status).toBe(401);
  });

  it('accounts persist across server instances (data lives in PostgreSQL)', async () => {
    const a = await register();
    const other = buildApp({
      config: TEST_CONFIG,
      db: ctx.db,
      logger: createLogger({ LOG_LEVEL: 'silent' }),
      mailer: new MemoryMailer(),
      version: 'test',
    });
    try {
      const res = await call({ app: other }, 'POST', `${V1}/auth/login`, {
        body: { email: a.email, password: a.password },
      });
      expect(res.status).toBe(200);
    } finally {
      await other.close();
    }
  });
});

describe('uniqueness', () => {
  it('rejects a duplicate e-mail regardless of casing/whitespace', async () => {
    const a = await register();
    const res = await call(ctx, 'POST', `${V1}/auth/register`, {
      body: { ...newAccount(), email: ` ${a.email.toUpperCase()}` },
    });
    expect(res.status).toBe(409);
    expect(errorCode(res.body)).toBe('email_unavailable');
    expect(res.sessionToken).toBeUndefined();
  });

  it('concurrent registrations of the same e-mail create exactly one account', async () => {
    const acc = newAccount('race');
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        call(ctx, 'POST', `${V1}/auth/register`, { body: { ...acc, displayName: `Racer ${i}` } }),
      ),
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(11);
    const { n } = await ctx.db
      .selectFrom('users')
      .select((eb) => eb.fn.countAll().as('n'))
      .where('email', '=', acc.email)
      .executeTakeFirstOrThrow();
    expect(Number(n)).toBe(1);
  });

  it('display names are not unique (the public id disambiguates)', async () => {
    const a = await register({ ...newAccount(), displayName: 'Same Name' });
    const b = await register({ ...newAccount(), displayName: 'Same Name' });
    expect(a.user.id).not.toBe(b.user.id);
  });
});

describe('session expiry and invalidation', () => {
  it('an expired session is rejected and the cookie is cleared', async () => {
    const a = await register();
    await sql`update sessions set created_at = now() - interval '2 days', expires_at = now() - interval '1 second'
              where token_hash = ${hashToken(a.token)}`.execute(ctx.db);
    const res = await call(ctx, 'GET', `${V1}/auth/session`, { token: a.token });
    expect(res.status).toBe(401);
    expect(res.sessionToken).toBe('');
  });

  it('purgeExpired removes only expired rows', async () => {
    const live = await register();
    const dead = await register();
    await sql`update sessions set created_at = now() - interval '2 days', expires_at = now() - interval '1 day'
              where token_hash = ${hashToken(dead.token)}`.execute(ctx.db);
    const purged = await ctx.app.auth.purgeExpired();
    expect(purged.sessions).toBeGreaterThanOrEqual(1);
    expect((await call(ctx, 'GET', `${V1}/auth/session`, { token: live.token })).status).toBe(200);
  });

  it('session lifetime follows SESSION_TTL_HOURS (cookie Max-Age and database expiry)', async () => {
    const a = await register();
    const row = await ctx.db
      .selectFrom('sessions')
      .select(['created_at', 'expires_at'])
      .where('token_hash', '=', hashToken(a.token))
      .executeTakeFirstOrThrow();
    const hours = (row.expires_at.getTime() - row.created_at.getTime()) / 3_600_000;
    expect(hours).toBeCloseTo(TEST_CONFIG.SESSION_TTL_HOURS, 3);
  });

  it('garbage, forged and unknown cookies are unauthenticated', async () => {
    for (const token of ['', 'x', 'a'.repeat(43), "'; drop table users; --"]) {
      const res = await call(ctx, 'GET', `${V1}/auth/session`, { headers: { cookie: `bar_sid=${token}` } });
      expect(res.status, token).toBe(401);
    }
  });
});

describe('account recovery', () => {
  it('reset link → new password; old password and every session stop working; token is single-use', async () => {
    const a = await register();
    const second = await call(ctx, 'POST', `${V1}/auth/login`, { body: { email: a.email, password: a.password } });

    expect((await call(ctx, 'POST', `${V1}/auth/recovery`, { body: { email: a.email } })).status).toBe(202);
    const token = ctx.mailer.tokenFor(a.email);
    const confirm = await call(ctx, 'POST', `${V1}/auth/recovery/confirm`, {
      body: { token, newPassword: 'brand new password' },
    });
    expect(confirm.status).toBe(204);

    for (const t of [a.token, second.sessionToken]) {
      expect((await call(ctx, 'GET', `${V1}/auth/session`, { token: t })).status).toBe(401);
    }
    const old = await call(ctx, 'POST', `${V1}/auth/login`, { body: { email: a.email, password: a.password } });
    expect(old.status).toBe(401);
    const fresh = await call(ctx, 'POST', `${V1}/auth/login`, {
      body: { email: a.email, password: 'brand new password' },
    });
    expect(fresh.status).toBe(200);

    const reuse = await call(ctx, 'POST', `${V1}/auth/recovery/confirm`, {
      body: { token, newPassword: 'another password' },
    });
    expect(reuse.status).toBe(400);
    expect(errorCode(reuse.body)).toBe('invalid_token');
  });

  it('a newer request invalidates the previous token; expired tokens are rejected', async () => {
    const a = await register();
    await call(ctx, 'POST', `${V1}/auth/recovery`, { body: { email: a.email } });
    const first = ctx.mailer.tokenFor(a.email);
    await call(ctx, 'POST', `${V1}/auth/recovery`, { body: { email: a.email } });
    const second = ctx.mailer.tokenFor(a.email);
    expect(second).not.toBe(first);
    const stale = await call(ctx, 'POST', `${V1}/auth/recovery/confirm`, {
      body: { token: first, newPassword: 'whatever password' },
    });
    expect(stale.status).toBe(400);

    await sql`update password_reset_tokens set created_at = now() - interval '2 hours',
              expires_at = now() - interval '1 second' where token_hash = ${hashToken(second)}`.execute(ctx.db);
    const expired = await call(ctx, 'POST', `${V1}/auth/recovery/confirm`, {
      body: { token: second, newPassword: 'whatever password' },
    });
    expect(expired.status).toBe(400);
    expect(errorCode(expired.body)).toBe('invalid_token');
  });

  it('the reset link points at the client and expires per configuration', async () => {
    const a = await register();
    await call(ctx, 'POST', `${V1}/auth/recovery`, { body: { email: a.email } });
    const msg = ctx.mailer.sent.findLast((m) => m.to === a.email)!;
    expect(msg.resetUrl.startsWith(`${TEST_CONFIG.PUBLIC_APP_URL}/#reset=`)).toBe(true);
    expect(msg.expiresInMinutes).toBe(TEST_CONFIG.PASSWORD_RESET_TTL_MINUTES);
  });
});

describe('account deletion', () => {
  it('requires the password, then removes the account, its sessions and its data', async () => {
    const a = await register();
    const wrong = await call(ctx, 'DELETE', `${V1}/account`, { token: a.token, body: { password: 'not my password' } });
    expect(wrong.status).toBe(401);
    expect(errorCode(wrong.body)).toBe('invalid_credentials');

    const ok = await call(ctx, 'DELETE', `${V1}/account`, { token: a.token, body: { password: a.password } });
    expect(ok.status).toBe(204);
    expect(ok.sessionToken).toBe('');
    expect((await call(ctx, 'GET', `${V1}/auth/session`, { token: a.token })).status).toBe(401);
    const login = await call(ctx, 'POST', `${V1}/auth/login`, { body: { email: a.email, password: a.password } });
    expect(login.status).toBe(401);
    const rows = await ctx.db.selectFrom('users').select('id').where('public_id', '=', a.user.id).execute();
    expect(rows).toHaveLength(0);
    // The e-mail becomes available again.
    await register({ ...newAccount(), email: a.email });
  });

  it('requires authentication', async () => {
    const res = await call(ctx, 'DELETE', `${V1}/account`, { body: { password: 'whatever' } });
    expect(res.status).toBe(401);
  });
});
