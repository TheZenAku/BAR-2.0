import { pino } from 'pino';
import type { Config } from './config.ts';

export type Logger = pino.Logger;

/** Structured JSON logger. Secrets must never be logged; known sensitive paths are redacted defensively. */
export function createLogger(config: Pick<Config, 'LOG_LEVEL'>): Logger {
  return pino({
    level: config.LOG_LEVEL,
    base: { service: 'bar-server' },
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.token'],
      censor: '[redacted]',
    },
  });
}
