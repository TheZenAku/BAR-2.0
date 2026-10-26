import type { AddressInfo } from 'node:net';
import { HealthResponse, PROTOCOL_VERSION } from '@bar/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHttpServer } from './http.ts';
import { createLogger } from './logger.ts';

describe('HTTP server', () => {
  const server = createHttpServer({ version: '1.2.3', logger: createLogger({ LOG_LEVEL: 'silent' }) });
  let base = '';

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  });

  it('GET /health returns a contract-valid payload', async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    const body = HealthResponse.parse(await res.json());
    expect(body.version).toBe('1.2.3');
    expect(body.protocol).toBe(PROTOCOL_VERSION);
  });

  it('returns 404 JSON for unknown routes and other methods', async () => {
    expect((await fetch(`${base}/nope`)).status).toBe(404);
    expect((await fetch(`${base}/health`, { method: 'POST' })).status).toBe(404);
  });
});
