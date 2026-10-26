import type { PublicUser } from '@bar/shared';
import { sql } from 'kysely';
import type { Config } from '../config.ts';
import { type Db, isUniqueViolation } from '../db/database.ts';
import { ApiError, invalidCredentials } from '../http/errors.ts';
import type { Logger } from '../logger.ts';
import type { Mailer } from '../mail/mailer.ts';
import { hashPassword, needsRehash, verifyAgainstDummy, verifyPassword } from './password.ts';
import { hashToken, newToken } from './tokens.ts';

export interface AuthenticatedUser {
  /** Internal id: used only inside the server. */
  userId: string;
  user: PublicUser;
}

type UserRow = { public_id: string; display_name: string; created_at: Date };

export const toPublicUser = (row: UserRow): PublicUser => ({
  id: row.public_id,
  displayName: row.display_name,
  createdAt: row.created_at.toISOString(),
});

export interface AuthServiceDeps {
  db: Db;
  mailer: Mailer;
  logger: Logger;
  config: Pick<Config, 'SESSION_TTL_HOURS' | 'PASSWORD_RESET_TTL_MINUTES' | 'PUBLIC_APP_URL'>;
}

/** Account and session rules. Inputs are already validated/normalized by the shared schemas. */
export class AuthService {
  private readonly deps: AuthServiceDeps;

  constructor(deps: AuthServiceDeps) {
    this.deps = deps;
  }

  /** Creates the account and its first session atomically. */
  async register(input: {
    email: string;
    password: string;
    displayName: string;
  }): Promise<{ user: PublicUser; token: string }> {
    const passwordHash = await hashPassword(input.password);
    try {
      return await this.deps.db.transaction().execute(async (trx) => {
        const row = await trx
          .insertInto('users')
          .values({ email: input.email, password_hash: passwordHash, display_name: input.displayName })
          .returning(['id', 'public_id', 'display_name', 'created_at'])
          .executeTakeFirstOrThrow();
        const token = await this.createSession(trx, row.id);
        return { user: toPublicUser(row), token };
      });
    } catch (err) {
      // Concurrent duplicates are resolved by the unique index, not by a racy pre-check.
      if (isUniqueViolation(err, 'users_email_key')) {
        throw new ApiError(409, 'email_unavailable', 'This email cannot be used to register');
      }
      throw err;
    }
  }

  /** Same response and comparable cost for "unknown email" and "wrong password" (no enumeration). */
  async login(input: { email: string; password: string }): Promise<{ user: PublicUser; token: string }> {
    const row = await this.deps.db
      .selectFrom('users')
      .select(['id', 'public_id', 'display_name', 'created_at', 'password_hash'])
      .where('email', '=', input.email)
      .executeTakeFirst();
    if (!row) {
      await verifyAgainstDummy(input.password);
      throw invalidCredentials();
    }
    if (!(await verifyPassword(row.password_hash, input.password))) throw invalidCredentials();
    if (needsRehash(row.password_hash)) {
      const upgraded = await hashPassword(input.password);
      await this.deps.db
        .updateTable('users')
        .set({ password_hash: upgraded, updated_at: new Date() })
        .where('id', '=', row.id)
        .execute();
    }
    const token = await this.createSession(this.deps.db, row.id);
    return { user: toPublicUser(row), token };
  }

  /** Resolves a session cookie to its user; expired or revoked sessions resolve to undefined. */
  async authenticate(token: string): Promise<AuthenticatedUser | undefined> {
    const row = await this.deps.db
      .selectFrom('sessions')
      .innerJoin('users', 'users.id', 'sessions.user_id')
      .select(['users.id', 'users.public_id', 'users.display_name', 'users.created_at'])
      .where('sessions.token_hash', '=', hashToken(token))
      .where('sessions.expires_at', '>', sql<Date>`now()`)
      .executeTakeFirst();
    return row ? { userId: row.id, user: toPublicUser(row) } : undefined;
  }

  /** Idempotent: revoking an unknown or already revoked session is not an error. */
  async logout(token: string): Promise<void> {
    await this.deps.db.deleteFrom('sessions').where('token_hash', '=', hashToken(token)).execute();
  }

  /**
   * Always completes silently, whether or not the account exists. A single-use token replaces any previous one;
   * delivery happens in the background so the response time does not reveal the account's existence.
   */
  async requestRecovery(email: string): Promise<void> {
    const { db, config, mailer, logger } = this.deps;
    const user = await db.selectFrom('users').select(['id']).where('email', '=', email).executeTakeFirst();
    if (!user) return;
    const token = newToken();
    await db.transaction().execute(async (trx) => {
      await trx.deleteFrom('password_reset_tokens').where('user_id', '=', user.id).execute();
      await trx
        .insertInto('password_reset_tokens')
        .values({
          token_hash: hashToken(token),
          user_id: user.id,
          expires_at: sql<Date>`now() + make_interval(mins => ${config.PASSWORD_RESET_TTL_MINUTES})`,
        })
        .execute();
    });
    const resetUrl = new URL(`#reset=${token}`, config.PUBLIC_APP_URL).toString();
    mailer
      .sendPasswordReset({ to: email, resetUrl, expiresInMinutes: config.PASSWORD_RESET_TTL_MINUTES })
      .catch((err: unknown) =>
        logger.error({ err: { message: (err as Error).message } }, 'password reset delivery failed'),
      );
  }

  /** Consumes the token (single use), sets the new password and revokes every session of the account. */
  async confirmRecovery(token: string, newPassword: string): Promise<void> {
    const passwordHash = await hashPassword(newPassword);
    await this.deps.db.transaction().execute(async (trx) => {
      const consumed = await trx
        .deleteFrom('password_reset_tokens')
        .where('token_hash', '=', hashToken(token))
        .where('expires_at', '>', sql<Date>`now()`)
        .returning(['user_id'])
        .executeTakeFirst();
      if (!consumed) throw new ApiError(400, 'invalid_token', 'Invalid or expired recovery token');
      await trx
        .updateTable('users')
        .set({ password_hash: passwordHash, updated_at: new Date() })
        .where('id', '=', consumed.user_id)
        .execute();
      await trx.deleteFrom('sessions').where('user_id', '=', consumed.user_id).execute();
      await trx.deleteFrom('password_reset_tokens').where('user_id', '=', consumed.user_id).execute();
    });
  }

  /** Hard delete after password re-confirmation; sessions and tokens go with it (FK cascade). See ADR-0004. */
  async deleteAccount(userId: string, password: string): Promise<void> {
    const row = await this.deps.db
      .selectFrom('users')
      .select(['password_hash'])
      .where('id', '=', userId)
      .executeTakeFirst();
    if (!row || !(await verifyPassword(row.password_hash, password))) throw invalidCredentials();
    await this.deps.db.deleteFrom('users').where('id', '=', userId).execute();
  }

  async findPublicUser(publicId: string): Promise<PublicUser | undefined> {
    const row = await this.deps.db
      .selectFrom('users')
      .select(['public_id', 'display_name', 'created_at'])
      .where('public_id', '=', publicId)
      .executeTakeFirst();
    return row ? toPublicUser(row) : undefined;
  }

  /** Deletes expired sessions and recovery tokens. Run periodically. */
  async purgeExpired(): Promise<{ sessions: number; resetTokens: number }> {
    const { db } = this.deps;
    const s = await db.deleteFrom('sessions').where('expires_at', '<=', sql<Date>`now()`).executeTakeFirst();
    const t = await db
      .deleteFrom('password_reset_tokens')
      .where('expires_at', '<=', sql<Date>`now()`)
      .executeTakeFirst();
    return { sessions: Number(s.numDeletedRows), resetTokens: Number(t.numDeletedRows) };
  }

  private async createSession(db: Pick<Db, 'insertInto'>, userId: string): Promise<string> {
    const token = newToken();
    await db
      .insertInto('sessions')
      .values({
        token_hash: hashToken(token),
        user_id: userId,
        expires_at: sql<Date>`now() + make_interval(hours => ${this.deps.config.SESSION_TTL_HOURS})`,
      })
      .execute();
    return token;
  }
}
