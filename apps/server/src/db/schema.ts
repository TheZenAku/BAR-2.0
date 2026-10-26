import type { ColumnType, Generated } from 'kysely';

// Row types for Kysely. Must match the migrations; the integration tests exercise every column.
// int8 columns come back from `pg` as strings (no precision loss); they never leave the server.

type CreatedAt = ColumnType<Date, never, never>;

export interface UsersTable {
  id: Generated<string>;
  public_id: Generated<string>;
  email: string;
  password_hash: string;
  display_name: string;
  created_at: CreatedAt;
  updated_at: ColumnType<Date, never, Date>;
}

export interface SessionsTable {
  id: Generated<string>;
  token_hash: Buffer;
  user_id: string;
  created_at: CreatedAt;
  expires_at: Date;
}

export interface PasswordResetTokensTable {
  id: Generated<string>;
  token_hash: Buffer;
  user_id: string;
  created_at: CreatedAt;
  expires_at: Date;
}

export interface Database {
  users: UsersTable;
  sessions: SessionsTable;
  password_reset_tokens: PasswordResetTokensTable;
}
