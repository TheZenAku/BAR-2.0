// `npm run db:migrate -w @bar/server [-- down]`: applies pending migrations (or reverts the last one).
import type { Kysely } from 'kysely';
import { loadConfig } from '../config.ts';
import { createLogger } from '../logger.ts';
import { createDatabase } from './database.ts';
import { createMigrator, migrateToLatest } from './migrator.ts';

const config = loadConfig();
const logger = createLogger(config);
const db = createDatabase(config, logger) as unknown as Kysely<unknown>;
try {
  if (process.argv[2] === 'down') {
    const { error, results } = await createMigrator(db).migrateDown();
    if (error) throw error;
    logger.info({ reverted: results?.map((r) => r.migrationName) ?? [] }, 'migration reverted');
  } else {
    logger.info({ applied: await migrateToLatest(db) }, 'migrations up to date');
  }
} catch (err) {
  logger.error({ err }, 'migration failed');
  process.exitCode = 1;
} finally {
  await db.destroy();
}
