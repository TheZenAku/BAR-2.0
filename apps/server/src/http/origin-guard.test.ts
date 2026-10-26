import { describe, expect, it } from 'vitest';
import { ApiError } from './errors.ts';
import { assertTrustedOrigin } from './origin-guard.ts';

const allowed = new Set(['https://bar.example']);
const json = { 'content-type': 'application/json; charset=utf-8' };

const codeOf = (fn: () => void): string | undefined => {
  try {
    fn();
    return undefined;
  } catch (e) {
    return e instanceof ApiError ? e.code : 'unexpected';
  }
};

describe('assertTrustedOrigin', () => {
  it('ignores safe methods', () => {
    expect(codeOf(() => assertTrustedOrigin('GET', { origin: 'https://evil.example' }, allowed))).toBeUndefined();
  });

  it('requires JSON bodies on state-changing requests (blocks HTML form CSRF)', () => {
    for (const ct of [
      'application/x-www-form-urlencoded',
      'multipart/form-data; boundary=x',
      'text/plain',
      undefined,
    ]) {
      expect(
        codeOf(() => assertTrustedOrigin('POST', { 'content-type': ct, origin: 'https://bar.example' }, allowed)),
      ).toBe('unsupported_media_type');
    }
  });

  it('accepts allowlisted origins and rejects others (exact match)', () => {
    expect(
      codeOf(() => assertTrustedOrigin('POST', { ...json, origin: 'https://bar.example' }, allowed)),
    ).toBeUndefined();
    for (const o of ['https://evil.example', 'https://bar.example.evil.test', 'http://bar.example', 'null']) {
      expect(
        codeOf(() => assertTrustedOrigin('DELETE', { ...json, origin: o }, allowed)),
        o,
      ).toBe('forbidden_origin');
    }
  });

  it('without Origin, falls back to Fetch Metadata', () => {
    expect(codeOf(() => assertTrustedOrigin('POST', json, allowed))).toBeUndefined(); // non-browser client
    expect(
      codeOf(() => assertTrustedOrigin('POST', { ...json, 'sec-fetch-site': 'same-origin' }, allowed)),
    ).toBeUndefined();
    for (const s of ['cross-site', 'same-site', 'none']) {
      expect(
        codeOf(() => assertTrustedOrigin('POST', { ...json, 'sec-fetch-site': s }, allowed)),
        s,
      ).toBe('forbidden_origin');
    }
  });
});
