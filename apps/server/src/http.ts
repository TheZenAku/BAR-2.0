import { createServer, type Server } from 'node:http';
import { HealthResponse, PROTOCOL_VERSION } from '@bar/shared';
import type { Logger } from './logger.ts';

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'cache-control': 'no-store',
} as const;

export function createHttpServer(options: { version: string; logger: Logger }): Server {
  const startedAt = performance.now();
  return createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/health') {
      const body = HealthResponse.parse({
        status: 'ok',
        version: options.version,
        protocol: PROTOCOL_VERSION,
        uptimeSeconds: (performance.now() - startedAt) / 1000,
      });
      res.writeHead(200, { ...SECURITY_HEADERS, 'content-type': 'application/json' }).end(JSON.stringify(body));
      return;
    }
    options.logger.debug({ method: req.method, path: url.pathname }, 'not found');
    res.writeHead(404, { ...SECURITY_HEADERS, 'content-type': 'application/json' }).end('{"error":"not_found"}');
  });
}
