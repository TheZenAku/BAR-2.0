import { describe, expect, it } from 'vitest';
import { RateLimiter } from './rate-limit.ts';

describe('RateLimiter', () => {
  it('allows `limit` hits per window, then reports seconds until reset', () => {
    let now = 0;
    const rl = new RateLimiter(() => now);
    const rule = { limit: 3, windowMs: 10_000 };
    expect([1, 2, 3].map(() => rl.hit('ip:a', rule))).toEqual([0, 0, 0]);
    expect(rl.hit('ip:a', rule)).toBe(10);
    now = 7_500;
    expect(rl.hit('ip:a', rule)).toBe(3);
    expect(rl.hit('ip:b', rule)).toBe(0); // keys are independent
    now = 10_000;
    expect(rl.hit('ip:a', rule)).toBe(0); // new window
  });

  it('bounds memory by sweeping expired windows', () => {
    let now = 0;
    const rl = new RateLimiter(() => now);
    const rule = { limit: 1, windowMs: 1000 };
    for (let i = 0; i < 10_000; i++) rl.hit(`k${i}`, rule);
    now = 1000;
    rl.hit('fresh', rule);
    expect(rl.size).toBe(1);
  });
});
