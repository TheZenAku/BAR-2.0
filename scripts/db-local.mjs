// Development PostgreSQL without Docker: runs the official binaries from the `embedded-postgres` dev dependency with
// the user, password, port and database taken from DATABASE_URL in .env (same URL that `npm run db:up` serves).
// Data persists in .data/pg-dev (git-ignored). Ctrl+C stops the server.
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import pg from 'pg';
import { startPostgres } from '../tests/support/postgres.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const envFile = join(ROOT, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set: copy .env.example to .env first.');
  process.exit(1);
}
const url = new URL(process.env.DATABASE_URL);
if (!['127.0.0.1', 'localhost'].includes(url.hostname)) {
  console.error(`db:local only serves loopback URLs (DATABASE_URL host is ${url.hostname}).`);
  process.exit(1);
}
const database = decodeURIComponent(url.pathname.slice(1));
const server = await startPostgres({
  name: 'pg-dev',
  port: Number(url.port || 5432),
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  external: '',
});

const admin = new pg.Client({ connectionString: server.adminUrl });
await admin.connect();
const exists = await admin.query('select 1 from pg_database where datname = $1', [database]);
if (exists.rowCount === 0) await admin.query(`create database ${pg.escapeIdentifier(database)}`);
await admin.end();
console.log(
  `PostgreSQL ready on 127.0.0.1:${url.port || 5432}, database "${database}" (${server.source}). Ctrl+C to stop.`,
);

let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  await server.stop();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
setInterval(() => {}, 1 << 30);
