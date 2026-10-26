// Real PostgreSQL for tests and local development — never an in-memory substitute.
//  - BAR_TEST_DATABASE_URL set (CI: Docker Compose service): uses that server. It must point to a disposable server;
//    tests only ever create and drop their own `bar_test_*` databases there.
//  - Otherwise: starts the official PostgreSQL binaries shipped by the `embedded-postgres` dev dependency, with the
//    cluster in .data/<name> (git-ignored), bound to 127.0.0.1 on a free port. No global install, no Docker.
// Deliberately never reads DATABASE_URL, so tests cannot reach the application's (or production) database.
import { existsSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const LOCAL_USER = 'bar';
const LOCAL_PASSWORD = 'bar_local_only';

export const freePort = () =>
  new Promise((res, rej) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => res(port));
    });
    s.on('error', rej);
  });

/**
 * Starts (or reuses) a PostgreSQL server for tests.
 * @param {{ name: string, port?: number, user?: string, password?: string, external?: string }} opts
 *   name: cluster directory under .data/ (one per concurrent user); external: use this server instead.
 * @returns {Promise<{ adminUrl: string, source: string, stop: () => Promise<void> }>}
 */
export async function startPostgres({
  name,
  port,
  user = LOCAL_USER,
  password = LOCAL_PASSWORD,
  external = process.env.BAR_TEST_DATABASE_URL,
}) {
  if (external) return { adminUrl: external, source: 'BAR_TEST_DATABASE_URL', stop: async () => {} };

  const { default: EmbeddedPostgres } = await import('embedded-postgres');
  // BAR_PG_SUFFIX selects another cluster directory (e.g. when a stale process still holds the default one).
  const databaseDir = join(ROOT, '.data', `${name}${process.env.BAR_PG_SUFFIX ?? ''}`);
  const actualPort = port ?? (await freePort());
  const logs = [];
  const pg = new EmbeddedPostgres({
    databaseDir,
    port: actualPort,
    user,
    password,
    persistent: true,
    // io_method=sync: no PG18 io_worker processes. On Windows an io_worker sometimes outlived its stopped server and
    // kept the cluster's shared memory, so the next start failed ('pre-existing shared memory block is still in use').
    postgresFlags: ['-c', 'listen_addresses=127.0.0.1', '-c', 'io_method=sync'],
    onLog: (m) => logs.push(String(m)),
    onError: (m) => logs.push(String(m)),
  });
  try {
    // A half-created cluster (interrupted initdb) is unusable: recreate it.
    if (existsSync(databaseDir) && !existsSync(join(databaseDir, 'PG_VERSION')))
      rmSync(databaseDir, { recursive: true });
    if (!existsSync(databaseDir)) await pg.initialise();
    await pg.start();
  } catch (err) {
    throw new Error(`embedded PostgreSQL failed to start: ${err}\n${logs.slice(-20).join('\n')}`);
  }
  return {
    adminUrl: `postgres://${encodeURIComponent(user)}:${encodeURIComponent(password)}@127.0.0.1:${actualPort}/postgres`,
    source: `embedded-postgres (${databaseDir})`,
    stop: () => pg.stop(),
  };
}

const TEST_DB_RE = /^bar_test_[a-z0-9_]+$/;

/** Creates an empty, uniquely named database and returns its URL plus a drop function. */
export async function createTestDatabase(adminUrl, label = 'db') {
  const { default: pg } = await import('pg');
  const name = `bar_test_${label}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  if (!TEST_DB_RE.test(name)) throw new Error(`refusing unsafe test database name: ${name}`);
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(`create database "${name}"`);
  } finally {
    await admin.end();
  }
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  return {
    url: url.toString(),
    name,
    drop: async () => {
      const c = new pg.Client({ connectionString: adminUrl });
      await c.connect();
      try {
        await c.query(`drop database if exists "${name}" with (force)`);
      } finally {
        await c.end();
      }
    },
  };
}
