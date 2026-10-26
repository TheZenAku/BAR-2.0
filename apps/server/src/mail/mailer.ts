import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Config } from '../config.ts';
import type { Logger } from '../logger.ts';

export interface PasswordResetMessage {
  to: string;
  resetUrl: string;
  expiresInMinutes: number;
}

/** Outgoing account e-mail. No real provider until one is chosen (ADR-0004); messages are never logged. */
export interface Mailer {
  sendPasswordReset(message: PasswordResetMessage): Promise<void>;
}

export function createMailer(transport: Config['MAIL_TRANSPORT'], logger: Logger, outboxDir: string): Mailer {
  if (transport === 'dev-outbox') {
    return {
      async sendPasswordReset(message) {
        await mkdir(outboxDir, { recursive: true });
        const file = join(outboxDir, `${Date.now()}-password-reset.json`);
        await writeFile(file, `${JSON.stringify({ ...message, createdAt: new Date().toISOString() }, null, 2)}\n`, {
          mode: 0o600,
        });
        logger.info({ file }, 'password reset written to dev outbox');
      },
    };
  }
  return {
    async sendPasswordReset() {
      logger.warn('password reset requested but MAIL_TRANSPORT=disabled: no message sent');
    },
  };
}
