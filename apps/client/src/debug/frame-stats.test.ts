import { describe, expect, it } from 'vitest';
import { FrameStats } from './frame-stats.ts';

describe('FrameStats', () => {
  it('computes fps and percentiles', () => {
    const s = new FrameStats(100);
    for (let i = 1; i <= 100; i++) s.push(i);
    const r = s.summary();
    expect(r.frames).toBe(100);
    expect(r.avgMs).toBeCloseTo(50.5);
    expect(r.p50Ms).toBe(51);
    expect(r.p95Ms).toBe(96);
    expect(r.maxMs).toBe(100);
    expect(r.fps).toBeCloseTo(1000 / 50.5);
  });

  it('keeps only the most recent samples and ignores invalid ones', () => {
    const s = new FrameStats(3);
    for (const v of [100, 100, 100, 1, 2, 3, Number.NaN, -1]) s.push(v);
    expect(s.summary().maxMs).toBe(3);
    expect(s.summary().frames).toBe(3);
    s.reset();
    expect(s.summary().frames).toBe(0);
  });
});
