import { describe, expect, it } from 'vitest';
import { PROFILES, pixelRatioFor, resolveProfile } from './graphics-profile.ts';

describe('graphics profile', () => {
  it('reads ?gfx and falls back to medium for unknown values', () => {
    expect(resolveProfile('?gfx=low').name).toBe('low');
    expect(resolveProfile('?gfx=high&x=1').name).toBe('high');
    expect(resolveProfile('?gfx=toString').name).toBe('medium');
    expect(resolveProfile('').name).toBe('medium');
  });

  it('caps the pixel ratio per profile', () => {
    expect(pixelRatioFor(PROFILES.low, 3)).toBe(1);
    expect(pixelRatioFor(PROFILES.medium, 3)).toBe(1.5);
    expect(pixelRatioFor(PROFILES.high, 1.25)).toBe(1.25);
    expect(pixelRatioFor(PROFILES.high, 0)).toBe(1);
  });
});
