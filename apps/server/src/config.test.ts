import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.ts';

describe('loadConfig', () => {
  it('applies defaults', () => {
    expect(loadConfig({})).toEqual({ NODE_ENV: 'development', HOST: '127.0.0.1', PORT: 2567, LOG_LEVEL: 'info' });
  });

  it('coerces PORT from string', () => {
    expect(loadConfig({ PORT: '8080' }).PORT).toBe(8080);
  });

  it('rejects invalid values with a readable error', () => {
    expect(() => loadConfig({ PORT: '70000', LOG_LEVEL: 'loud' })).toThrow(
      /Invalid configuration[\s\S]*PORT[\s\S]*LOG_LEVEL/,
    );
  });
});
