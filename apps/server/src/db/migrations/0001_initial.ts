import { type Kysely, sql } from 'kysely';

// Accounts, sessions and password-reset tokens. Plain SQL so the schema is reviewable as-is.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table users (
      id bigint generated always as identity primary key,
      -- Stable public identifier; the internal id never leaves the server.
      public_id uuid not null default gen_random_uuid(),
      email text not null,
      password_hash text not null,
      display_name text not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      constraint users_public_id_key unique (public_id),
      -- Normalization happens in the API; the database refuses anything that bypassed it.
      constraint users_email_normalized check (email = lower(btrim(email)) and char_length(email) between 3 and 254),
      constraint users_display_name_length check (char_length(display_name) between 3 and 20),
      constraint users_password_hash_format check (password_hash like '$argon2id$%')
    )`.execute(db);
  // Uniqueness of the login identifier; also the lookup index for login and recovery.
  await sql`create unique index users_email_key on users (email)`.execute(db);

  await sql`
    create table sessions (
      id bigint generated always as identity primary key,
      -- SHA-256 of the cookie token: a database leak does not yield usable sessions.
      token_hash bytea not null,
      user_id bigint not null references users (id) on delete cascade,
      created_at timestamptz not null default now(),
      expires_at timestamptz not null,
      constraint sessions_token_hash_key unique (token_hash),
      constraint sessions_token_hash_len check (octet_length(token_hash) = 32),
      constraint sessions_expiry_after_creation check (expires_at > created_at)
    )`.execute(db);
  // Revoke-all on password reset / account deletion, and the FK cascade.
  await sql`create index sessions_user_id_idx on sessions (user_id)`.execute(db);
  // Periodic purge of expired rows.
  await sql`create index sessions_expires_at_idx on sessions (expires_at)`.execute(db);

  await sql`
    create table password_reset_tokens (
      id bigint generated always as identity primary key,
      token_hash bytea not null,
      user_id bigint not null references users (id) on delete cascade,
      created_at timestamptz not null default now(),
      expires_at timestamptz not null,
      constraint password_reset_tokens_token_hash_key unique (token_hash),
      constraint password_reset_tokens_token_hash_len check (octet_length(token_hash) = 32),
      constraint password_reset_tokens_expiry_after_creation check (expires_at > created_at)
    )`.execute(db);
  await sql`create index password_reset_tokens_user_id_idx on password_reset_tokens (user_id)`.execute(db);
  await sql`create index password_reset_tokens_expires_at_idx on password_reset_tokens (expires_at)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop table password_reset_tokens`.execute(db);
  await sql`drop table sessions`.execute(db);
  await sql`drop table users`.execute(db);
}
