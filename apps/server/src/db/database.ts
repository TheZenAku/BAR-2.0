import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import type { Config } from '../config.ts';
import type { Logger } from '../logger.ts';
import type { Database } from './schema.ts';

export type Db = Kysely<Database>;

export type DbConfig = Pick<
  Config,
  'DATABASE_URL' | 'DB_POOL_MAX' | 'DB_CONNECT_TIMEOUT_MS' | 'DB_STATEMENT_TIMEOUT_MS'
>;

/** Kysely over a bounded `pg` pool. Connections are lazy: an unreachable database does not prevent startup. */
export function createDatabase(config: DbConfig, logger: Logger): Db {
  const pool = new pg.Pool({
    connectionString: config.DATABASE_URL,
    max: config.DB_POOL_MAX,
    connectionTimeoutMillis: config.DB_CONNECT_TIMEOUT_MS,
    idleTimeoutMillis: 30_000,
    statement_timeout: config.DB_STATEMENT_TIMEOUT_MS,
    application_name: 'bar-server',
  });
  // Errors on idle clients (e.g. the server restarted) must not crash the process; the pool replaces the client.
  pool.on('error', (err) =>
    logger.warn({ err: { message: err.message, code: errorCode(err) } }, 'idle db client error'),
  );
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
}

/** True when the database answers within the timeout. Never throws. */
export async function pingDatabase(db: Db, timeoutMs = 2000): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  const ping = sql`select 1`.execute(db).then(
    () => true,
    () => false,
  );
  try {
    return await Promise.race([ping, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

const errorCode = (err: unknown): string | undefined =>
  typeof err === 'object' && err !== null && 'code' in err && typeof err.code === 'string' ? err.code : undefined;

const NETWORK_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH']);

/**
 * True for errors meaning "the database is unreachable or refusing work" (→ HTTP 503), as opposed to query bugs.
 * SQLSTATE classes: 08 connection exception, 53 insufficient resources, 57P0x operator intervention/shutdown.
 */
export function isDatabaseUnavailable(err: unknown): boolean {
  const code = errorCode(err);
  if (code !== undefined) {
    if (NETWORK_CODES.has(code) || /^(08|53|57P0)/.test(code)) return true;
  }
  if (err instanceof Error) {
    if (/timeout exceeded when trying to connect|Connection terminated/i.test(err.message)) return true;
    if (err instanceof AggregateError) return err.errors.some(isDatabaseUnavailable);
    if (err.cause !== undefined && err.cause !== err) return isDatabaseUnavailable(err.cause);
  }
  return false;
}

export const isUniqueViolation = (err: unknown, constraint: string): boolean =>
  errorCode(err) === '23505' &&
  typeof err === 'object' &&
  err !== null &&
  'constraint' in err &&
  err.constraint === constraint;
