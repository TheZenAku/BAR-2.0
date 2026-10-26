import { PROTOCOL_VERSION } from '@bar/shared';
import { describe, expect, it } from 'vitest';
import { fetchServerStatus } from './health.ts';

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('fetchServerStatus', () => {
  it('returns online with a valid contract', async () => {
    const health = { status: 'ok', version: '0.0.0', protocol: PROTOCOL_VERSION, uptimeSeconds: 3 };
    await expect(fetchServerStatus(async () => jsonResponse(health))).resolves.toEqual({ online: true, health });
  });

  it('reports HTTP errors, invalid payloads and network failures without throwing', async () => {
    await expect(fetchServerStatus(async () => jsonResponse({}, 503))).resolves.toEqual({
      online: false,
      reason: 'HTTP 503',
    });
    await expect(fetchServerStatus(async () => jsonResponse({ status: 'ok' }))).resolves.toMatchObject({
      online: false,
    });
    await expect(
      fetchServerStatus(async () => {
        throw new TypeError('network');
      }),
    ).resolves.toEqual({ online: false, reason: 'servidor indisponível' });
  });
});
