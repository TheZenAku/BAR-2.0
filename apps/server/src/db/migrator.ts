import type { Kysely } from 'kysely';
import { type Migration, Migrator } from 'kysely/migration';
import * as m0001 from './migrations/0001_initial.ts';

// Versioned, append-only list: never edit or reorder an applied migration, add a new one.
// Static imports (not a directory scan) keep the set explicit, type-checked and bundler-proof.
export const MIGRATIONS: Record<string, Migration> = {
  '0001_initial': m0001,
};

export function createMigrator(db: Kysely<unknown>): Migrator {
  return new Migrator({ db, provider: { getMigrations: async () => MIGRATIONS } });
}

/** Applies every pending migration (Kysely holds an advisory lock, so concurrent callers are serialized). */
export async function migrateToLatest(db: Kysely<unknown>): Promise<string[]> {
  const { error, results } = await createMigrator(db).migrateToLatest();
  if (error) throw error;
  return (results ?? []).filter((r) => r.status === 'Success').map((r) => r.migrationName);
}
