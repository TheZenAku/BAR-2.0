// Vitest globalSetup for the `integration` project: one PostgreSQL server per run; each test file creates its own
// database (see apps/server/src/testing/database.ts), so files run in parallel without sharing state.
import { startPostgres } from './postgres.mjs';

export default async function setup({ provide }) {
  const pg = await startPostgres({ name: 'pg-test' });
  console.warn(`[integration] PostgreSQL: ${pg.source}`);
  provide('pgAdminUrl', pg.adminUrl);
  return () => pg.stop();
}
