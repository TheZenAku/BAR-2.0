import { join } from 'node:path';
import type { Kysely } from 'kysely';
import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { createDatabase } from './db/database.ts';
import { migrateToLatest } from './db/migrator.ts';
import { createLogger } from './logger.ts';
import { createMailer } from './mail/mailer.ts';

const PURGE_INTERVAL_MS = 60 * 60 * 1000;

const config = loadConfig();
const logger = createLogger(config);
const db = createDatabase(config, logger);

if (config.DB_AUTO_MIGRATE) {
  try {
    const applied = await migrateToLatest(db as unknown as Kysely<unknown>);
    logger.info({ applied }, 'migrations up to date');
  } catch (err) {
    logger.fatal(
      { err: { message: (err as Error).message, code: (err as { code?: unknown }).code } },
      'migration failed',
    );
    await db.destroy();
    process.exit(1);
  }
}

const app = buildApp({
  config,
  db,
  logger,
  mailer: createMailer(config.MAIL_TRANSPORT, logger, join(import.meta.dirname, '../../../.data/outbox')),
  version: process.env.npm_package_version ?? '0.0.0',
});

await app.listen({ port: config.PORT, host: config.HOST });
logger.info({ host: config.HOST, port: config.PORT, env: config.NODE_ENV }, 'server listening');

const purge = setInterval(() => {
  app.auth.purgeExpired().then(
    (deleted) => logger.info({ deleted }, 'expired sessions purged'),
    (err: unknown) => logger.warn({ err: { message: (err as Error).message } }, 'purge failed'),
  );
}, PURGE_INTERVAL_MS);
purge.unref();

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutting down');
  setTimeout(() => {
    logger.warn('forced shutdown after timeout');
    process.exit(1);
  }, 10_000).unref();
  clearInterval(purge);
  app.startDraining();
  try {
    await app.close(); // stops accepting, waits for in-flight requests
    await db.destroy(); // releases pooled connections
    process.exit(0);
  } catch (err) {
    logger.error({ err }, 'error during shutdown');
    process.exit(1);
  }
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
