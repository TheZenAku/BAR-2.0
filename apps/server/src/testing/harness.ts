// Integration-test harness: a fresh, migrated PostgreSQL database per test file and an in-process Fastify app.
// The server URL comes from tests/support/vitest-postgres.mjs (real PostgreSQL); see that file for safety rules.
import type { Kysely } from 'kysely';
import pg from 'pg';
import { inject } from 'vitest';
import { type AppConfig, buildApp } from '../app.ts';
import { createDatabase, type Db } from '../db/database.ts';
import { migrateToLatest } from '../db/migrator.ts';
import type { RateLimits } from '../http/rate-limit.ts';
import { createLogger } from '../logger.ts';
import type { Mailer, PasswordResetMessage } from '../mail/mailer.ts';

declare module 'vitest' {
  export interface ProvidedContext {
    pgAdminUrl: string;
  }
}

export const ORIGIN = 'http://127.0.0.1:5173';

export const TEST_CONFIG: AppConfig = {
  SESSION_TTL_HOURS: 720,
  PASSWORD_RESET_TTL_MINUTES: 30,
  PUBLIC_APP_URL: ORIGIN,
  COOKIE_SECURE: false,
  ALLOWED_ORIGINS: [ORIGIN],
  TRUST_PROXY: false,
};

const generous = { limit: 10_000, windowMs: 60_000 };
/** For tests that are not about rate limiting (all requests share one IP). Rate-limit tests use the defaults. */
export const RELAXED_LIMITS: RateLimits = {
  register: { perIp: generous },
  login: { perIp: generous, perEmail: generous },
  recoveryRequest: { perIp: generous, perEmail: generous },
  recoveryConfirm: { perIp: generous },
  deleteAccount: { perIp: generous },
};

export class MemoryMailer implements Mailer {
  readonly sent: PasswordResetMessage[] = [];
  async sendPasswordReset(message: PasswordResetMessage): Promise<void> {
    this.sent.push(message);
  }
  /** Token from the most recent reset link sent to `to`. */
  tokenFor(to: string): string {
    const msg = this.sent.findLast((m) => m.to === to);
    const token = msg && new URL(msg.resetUrl).hash.replace(/^#reset=/, '');
    if (!token) throw new Error(`no reset message for ${to}`);
    return token;
  }
}

/** Creates an empty database named bar_test_* on the test server. Refuses any other name. */
export async function createTestDatabase(): Promise<{ url: string; drop: () => Promise<void> }> {
  const adminUrl = inject('pgAdminUrl');
  const name = `bar_test_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  if (!/^bar_test_[a-z0-9_]+$/.test(name)) throw new Error('unsafe test database name');
  const run = async (sql: string) => {
    const client = new pg.Client({ connectionString: adminUrl });
    await client.connect();
    try {
      await client.query(sql);
    } finally {
      await client.end();
    }
  };
  await run(`create database "${name}"`);
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  return { url: url.toString(), drop: () => run(`drop database if exists "${name}" with (force)`) };
}

export function testDb(url: string, logger = createLogger({ LOG_LEVEL: 'silent' })): Db {
  return createDatabase(
    { DATABASE_URL: url, DB_POOL_MAX: 10, DB_CONNECT_TIMEOUT_MS: 2000, DB_STATEMENT_TIMEOUT_MS: 10_000 },
    logger,
  );
}

export type TestContext = Awaited<ReturnType<typeof createTestContext>>;

export async function createTestContext(opts: { rateLimits?: RateLimits; config?: Partial<AppConfig> } = {}) {
  const database = await createTestDatabase();
  const logs: string[] = [];
  const logger = createLogger({ LOG_LEVEL: 'debug' }, { write: (line: string) => void logs.push(line) });
  const db = testDb(database.url, logger);
  await migrateToLatest(db as unknown as Kysely<unknown>);
  const mailer = new MemoryMailer();
  const app = buildApp({
    config: { ...TEST_CONFIG, ...opts.config },
    db,
    logger,
    mailer,
    version: 'test',
    rateLimits: opts.rateLimits ?? RELAXED_LIMITS,
  });
  await app.ready();
  return {
    app,
    db,
    mailer,
    logs,
    databaseUrl: database.url,
    close: async () => {
      await app.close();
      await db.destroy();
      await database.drop();
    },
  };
}

export interface ApiResult {
  status: number;
  body: unknown;
  raw: string;
  headers: Record<string, unknown>;
  /** Session token set by this response ('' when cleared, undefined when untouched). */
  sessionToken: string | undefined;
  setCookie: string[];
}

/** Browser-like request: JSON body and an allowlisted Origin on unsafe methods unless overridden. */
export async function call(
  ctx: Pick<TestContext, 'app'>,
  method: 'GET' | 'POST' | 'DELETE' | 'PUT',
  url: string,
  opts: { body?: unknown; token?: string | undefined; headers?: Record<string, string> } = {},
): Promise<ApiResult> {
  const unsafe = method !== 'GET';
  const headers: Record<string, string> = {
    ...(unsafe ? { 'content-type': 'application/json', origin: ORIGIN } : {}),
    ...(opts.token !== undefined ? { cookie: `bar_sid=${opts.token}` } : {}),
    ...opts.headers,
  };
  const res = await ctx.app.inject({
    method,
    url,
    headers,
    ...(unsafe ? { payload: typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body ?? {}) } : {}),
  });
  const setCookie = ([] as string[]).concat((res.headers['set-cookie'] as string | string[] | undefined) ?? []);
  const session = res.cookies.find((c) => c.name === 'bar_sid' || c.name === '__Host-bar_sid');
  let body: unknown;
  try {
    body = res.body ? JSON.parse(res.body) : undefined;
  } catch {
    body = undefined;
  }
  return { status: res.statusCode, body, raw: res.body, headers: res.headers, sessionToken: session?.value, setCookie };
}

let seq = 0;
/** Unique, valid registration input. */
export const newAccount = (prefix = 'user') => {
  seq++;
  const id = `${prefix}${seq}${Math.random().toString(36).slice(2, 7)}`;
  return { email: `${id}@example.com`, password: `pw-${id}-secret`, displayName: `Player ${seq}` };
};
