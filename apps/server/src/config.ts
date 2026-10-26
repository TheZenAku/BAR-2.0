import { z } from 'zod';

const DEV_ORIGINS = 'http://localhost:5173,http://127.0.0.1:5173';

const Env = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().min(1).default('127.0.0.1'),
    PORT: z.coerce.number().int().min(0).max(65535).default(2567),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    /** Secret: never logged. postgres://user:password@host:port/database */
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
    DB_CONNECT_TIMEOUT_MS: z.coerce.number().int().min(100).max(60_000).default(5000),
    DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(100).max(300_000).default(10_000),
    /** Apply pending migrations at startup (Kysely takes a lock, so concurrent starts are safe). */
    DB_AUTO_MIGRATE: z.stringbool().default(true),
    SESSION_TTL_HOURS: z.coerce
      .number()
      .int()
      .min(1)
      .max(24 * 90)
      .default(24 * 30),
    PASSWORD_RESET_TTL_MINUTES: z.coerce
      .number()
      .int()
      .min(5)
      .max(24 * 60)
      .default(30),
    /** Forced on in production. Secure cookies use the `__Host-` prefix. */
    COOKIE_SECURE: z.stringbool().default(false),
    /** Origins allowed to send state-changing requests (CSRF defense). Comma-separated, exact match. */
    ALLOWED_ORIGINS: z.string().optional(),
    /** Base URL of the web client, used in account-recovery links. */
    PUBLIC_APP_URL: z.url().default('http://127.0.0.1:5173'),
    /** Only enable behind a reverse proxy that overwrites X-Forwarded-For (rate limiting keys on the client IP). */
    TRUST_PROXY: z.stringbool().default(false),
    /** `dev-outbox` writes recovery messages to .data/outbox (never in production); `disabled` sends nothing. */
    MAIL_TRANSPORT: z.enum(['disabled', 'dev-outbox']).default('disabled'),
    /** Players in the shared room (M3). Load measured up to 16 (docs/execution/TESTS.md). */
    GAME_MAX_PLAYERS: z.coerce.number().int().min(1).max(64).default(16),
    /** Seconds a dropped player keeps their place while the client reconnects. */
    GAME_RECONNECT_SECONDS: z.coerce.number().int().min(0).max(300).default(20),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;
    if (!env.ALLOWED_ORIGINS)
      ctx.addIssue({ code: 'custom', path: ['ALLOWED_ORIGINS'], message: 'required in production' });
    if (env.MAIL_TRANSPORT === 'dev-outbox')
      ctx.addIssue({ code: 'custom', path: ['MAIL_TRANSPORT'], message: 'dev-outbox is not allowed in production' });
  })
  .transform((env) => ({
    ...env,
    COOKIE_SECURE: env.COOKIE_SECURE || env.NODE_ENV === 'production',
    ALLOWED_ORIGINS: (env.ALLOWED_ORIGINS ?? DEV_ORIGINS)
      .split(',')
      .map((o) => o.trim())
      .filter((o) => o.length > 0),
  }));

export type Config = z.output<typeof Env>;

/** Parses and validates configuration from the environment. Throws with all issues on invalid input. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid configuration:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}
