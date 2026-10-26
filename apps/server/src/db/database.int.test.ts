import { type Kysely, sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../auth/password.ts';
import { createTestDatabase, testDb } from '../testing/harness.ts';
import { type Db, isDatabaseUnavailable, isUniqueViolation, pingDatabase } from './database.ts';
import { createMigrator, MIGRATIONS, migrateToLatest } from './migrator.ts';

describe('migrations on a clean PostgreSQL database', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let db: Db;
  const raw = () => db as unknown as Kysely<unknown>;

  beforeAll(async () => {
    database = await createTestDatabase();
    db = testDb(database.url);
  });
  afterAll(async () => {
    await db.destroy();
    await database.drop();
  });

  const tables = async () =>
    (
      await sql<{ table_name: string }>`
        select table_name from information_schema.tables where table_schema = 'public' order by table_name`.execute(db)
    ).rows.map((r) => r.table_name);

  it('applies every migration from scratch, then is a no-op', async () => {
    expect(await tables()).toEqual([]);
    expect(await migrateToLatest(raw())).toEqual(Object.keys(MIGRATIONS));
    expect(await tables()).toEqual(
      expect.arrayContaining(['users', 'sessions', 'password_reset_tokens', 'kysely_migration']),
    );
    expect(await migrateToLatest(raw())).toEqual([]);
  });

  it('is reversible (down, then up again)', async () => {
    const { error } = await createMigrator(raw()).migrateDown();
    expect(error).toBeUndefined();
    expect(await tables()).not.toContain('users');
    expect(await migrateToLatest(raw())).toEqual(['0001_initial']);
  });

  it('concurrent migrators are serialized by the migration lock', async () => {
    const other = await createTestDatabase();
    const a = testDb(other.url);
    const b = testDb(other.url);
    try {
      const [ra, rb] = await Promise.all([
        migrateToLatest(a as unknown as Kysely<unknown>),
        migrateToLatest(b as unknown as Kysely<unknown>),
      ]);
      expect([...ra, ...rb]).toEqual(['0001_initial']);
    } finally {
      await a.destroy();
      await b.destroy();
      await other.drop();
    }
  });

  describe('constraints', () => {
    let hash: string;
    beforeAll(async () => {
      hash = await hashPassword('constraint test password');
    });
    const insertUser = (email: string, displayName = 'Tester', passwordHash = hash) =>
      db
        .insertInto('users')
        .values({ email, password_hash: passwordHash, display_name: displayName })
        .returning(['id', 'public_id', 'created_at', 'updated_at'])
        .executeTakeFirstOrThrow();

    it('generates stable ids and timestamps', async () => {
      const u = await insertUser('stable@example.com');
      expect(u.public_id).toMatch(/^[0-9a-f-]{36}$/);
      expect(u.created_at).toBeInstanceOf(Date);
      expect(u.updated_at).toBeInstanceOf(Date);
    });

    it('enforces e-mail uniqueness and normalization at the database level', async () => {
      await insertUser('unique@example.com');
      const dup = await insertUser('unique@example.com').catch((e: unknown) => e);
      expect(isUniqueViolation(dup, 'users_email_key')).toBe(true);
      await expect(insertUser('Upper@Example.com')).rejects.toThrow(/users_email_normalized/);
      await expect(insertUser(' pad@example.com')).rejects.toThrow(/users_email_normalized/);
    });

    it('rejects out-of-range display names and non-Argon2id hashes', async () => {
      await expect(insertUser('short@example.com', 'ab')).rejects.toThrow(/users_display_name_length/);
      await expect(insertUser('plain@example.com', 'Tester', 'plaintext')).rejects.toThrow(
        /users_password_hash_format/,
      );
    });

    it('cascades sessions and reset tokens when a user is deleted', async () => {
      const u = await insertUser('cascade@example.com');
      const token_hash = Buffer.alloc(32, 7);
      const expires_at = sql<Date>`now() + interval '1 hour'`;
      await db.insertInto('sessions').values({ token_hash, user_id: u.id, expires_at }).execute();
      await db.insertInto('password_reset_tokens').values({ token_hash, user_id: u.id, expires_at }).execute();
      await db.deleteFrom('users').where('id', '=', u.id).execute();
      const count = async (t: 'sessions' | 'password_reset_tokens') =>
        Number(
          (
            await db
              .selectFrom(t)
              .select((eb) => eb.fn.countAll().as('n'))
              .where('user_id', '=', u.id)
              .executeTakeFirstOrThrow()
          ).n,
        );
      expect(await count('sessions')).toBe(0);
      expect(await count('password_reset_tokens')).toBe(0);
    });

    it('rejects malformed token hashes', async () => {
      const u = await insertUser('tokenlen@example.com');
      await expect(
        db
          .insertInto('sessions')
          .values({ token_hash: Buffer.alloc(8), user_id: u.id, expires_at: sql<Date>`now() + interval '1 hour'` })
          .execute(),
      ).rejects.toThrow(/sessions_token_hash_len/);
    });
  });
});

describe('connection failure', () => {
  it('an unreachable server is reported as unavailable, without throwing from ping', async () => {
    const db = testDb('postgres://bar:x@127.0.0.1:1/none');
    try {
      expect(await pingDatabase(db)).toBe(false);
      const err = await sql`select 1`.execute(db).catch((e: unknown) => e);
      expect(isDatabaseUnavailable(err)).toBe(true);
    } finally {
      await db.destroy();
    }
  });

  it('query errors are not mistaken for unavailability', async () => {
    const database = await createTestDatabase();
    const db = testDb(database.url);
    try {
      const err = await sql`select * from no_such_table`.execute(db).catch((e: unknown) => e);
      expect(isDatabaseUnavailable(err)).toBe(false);
    } finally {
      await db.destroy();
      await database.drop();
    }
  });
});
