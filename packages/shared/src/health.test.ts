import { describe, expect, it } from 'vitest';
import { HealthResponse, PROTOCOL_VERSION } from './index.ts';

describe('HealthResponse', () => {
  const valid = { status: 'ok', version: '0.0.0', protocol: PROTOCOL_VERSION, uptimeSeconds: 1.5 };

  it('accepts a valid payload', () => {
    expect(HealthResponse.parse(valid)).toEqual(valid);
  });

  it('rejects unknown fields', () => {
    expect(HealthResponse.safeParse({ ...valid, extra: true }).success).toBe(false);
  });

  it('rejects a non-ok status and negative uptime', () => {
    expect(HealthResponse.safeParse({ ...valid, status: 'down' }).success).toBe(false);
    expect(HealthResponse.safeParse({ ...valid, uptimeSeconds: -1 }).success).toBe(false);
  });
});
