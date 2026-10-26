import { type DestinationStream, pino } from 'pino';
import type { Config } from './config.ts';

export type Logger = pino.Logger;

/**
 * Structured JSON logger; each HTTP request carries `reqId` (also returned as `x-request-id`) for correlation.
 * Code never logs secrets, e-mails or request bodies; known sensitive paths are also redacted defensively.
 */
export function createLogger(config: Pick<Config, 'LOG_LEVEL'>, destination?: DestinationStream): Logger {
  return pino(
    {
      level: config.LOG_LEVEL,
      base: { service: 'bar-server' },
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'res.headers["set-cookie"]',
          '*.password',
          '*.newPassword',
          '*.token',
          '*.email',
          '*.DATABASE_URL',
        ],
        censor: '[redacted]',
      },
    },
    destination,
  );
}
