import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.ts';

const DATABASE_URL = 'postgres://bar:secret@127.0.0.1:5432/bar';

describe('loadConfig', () => {
  it('applies defaults', () => {
    expect(loadConfig({ DATABASE_URL })).toMatchObject({
      NODE_ENV: 'development',
      HOST: '127.0.0.1',
      PORT: 2567,
      LOG_LEVEL: 'info',
      DB_POOL_MAX: 10,
      DB_AUTO_MIGRATE: true,
      SESSION_TTL_HOURS: 720,
      COOKIE_SECURE: false,
      ALLOWED_ORIGINS: ['http://localhost:5173', 'http://127.0.0.1:5173'],
      MAIL_TRANSPORT: 'disabled',
      TRUST_PROXY: false,
    });
  });

  it('coerces numbers and booleans from strings', () => {
    const c = loadConfig({
      DATABASE_URL,
      PORT: '8080',
      DB_AUTO_MIGRATE: 'false',
      ALLOWED_ORIGINS: ' https://a.test , ',
    });
    expect(c.PORT).toBe(8080);
    expect(c.DB_AUTO_MIGRATE).toBe(false);
    expect(c.ALLOWED_ORIGINS).toEqual(['https://a.test']);
  });

  it('requires a postgres DATABASE_URL', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
    expect(() => loadConfig({ DATABASE_URL: 'mysql://x@y/z' })).toThrow(/DATABASE_URL/);
  });

  it('forces secure cookies and requires explicit origins in production', () => {
    expect(() => loadConfig({ DATABASE_URL, NODE_ENV: 'production' })).toThrow(/ALLOWED_ORIGINS/);
    const c = loadConfig({ DATABASE_URL, NODE_ENV: 'production', ALLOWED_ORIGINS: 'https://bar.example' });
    expect(c.COOKIE_SECURE).toBe(true);
  });

  it('forbids the development mail outbox in production', () => {
    expect(() =>
      loadConfig({ DATABASE_URL, NODE_ENV: 'production', ALLOWED_ORIGINS: 'https://x', MAIL_TRANSPORT: 'dev-outbox' }),
    ).toThrow(/MAIL_TRANSPORT/);
  });

  it('rejects invalid values with a readable error that does not echo the secret', () => {
    let message = '';
    try {
      loadConfig({ DATABASE_URL, PORT: '70000', LOG_LEVEL: 'loud' });
    } catch (e) {
      message = String(e);
    }
    expect(message).toMatch(/Invalid configuration[\s\S]*PORT[\s\S]*LOG_LEVEL/);
    expect(message).not.toContain('secret');
  });
});
