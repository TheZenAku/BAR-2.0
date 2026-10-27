// Remote gateway: access gate, Host allowlist, fixed routes, header rewriting and WebSocket upgrade forwarding,
// against a fake API on loopback (no tunnel, no database).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ACCESS_PARAM, createGateway, GATE_COOKIE, gateValue } from './gateway.mjs';

const HOST = 'demo.example.test';
const TOKEN = 'token-de-teste-com-tamanho-suficiente';
const GATE = `${GATE_COOKIE}=${gateValue(TOKEN)}`;
let dir;
let api;
let gw;
let port;
let seen; // last request received by the fake API

const listen = (server) => new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));
const call = (path, { method = 'GET', headers = {}, upgrade = false } = {}) =>
  new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method, headers: { host: HOST, ...headers } });
    req.on('response', (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    if (upgrade)
      req.on('upgrade', (res, socket) => {
        socket.destroy();
        resolve({ status: res.statusCode, headers: res.headers });
      });
    req.on('error', reject);
    req.end();
  });
const upgrade = (path, headers = {}) =>
  call(path, { upgrade: true, headers: { connection: 'Upgrade', upgrade: 'websocket', ...headers } });

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'bar-gw-'));
  const web = join(dir, 'web');
  mkdirSync(join(web, 'assets'), { recursive: true });
  writeFileSync(join(web, 'index.html'), '<canvas></canvas>');
  writeFileSync(join(web, 'assets', 'app.js'), 'export {}');
  writeFileSync(join(web, '.secret'), 'x');
  const art = join(dir, 'art');
  mkdirSync(join(art, 'pack'), { recursive: true });
  writeFileSync(join(art, 'catalog.json'), '{}');
  writeFileSync(join(art, 'pack', 'a.glb'), 'glb');
  writeFileSync(join(art, 'report.json'), '{}');
  api = createServer((req, res) => {
    seen = { url: req.url, headers: req.headers };
    res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': '__Host-bar_sid=s; Path=/; Secure' });
    res.end('{"ok":true}');
  });
  api.on('upgrade', (req, socket) => {
    seen = { url: req.url, headers: req.headers };
    socket.end('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n');
  });
  const apiPort = await listen(api);
  gw = createGateway({
    webRoot: web,
    artRoot: art,
    artFiles: ['pack/a.glb'],
    apiPort,
    token: TOKEN,
    publicOrigin: 'http://placeholder.invalid',
  });
  gw.setPublicOrigin(`https://${HOST}`);
  port = await listen(gw.server);
});

afterAll(async () => {
  await new Promise((r) => gw.server.close(r));
  await new Promise((r) => api.close(r));
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  seen = undefined;
});

describe('access gate', () => {
  it('rejects unknown hosts before anything else', async () => {
    expect((await call('/', { headers: { host: 'evil.test', cookie: GATE } })).status).toBe(421);
  });

  it('answers 401 without the access cookie, on pages, API and WebSocket alike', async () => {
    expect((await call('/')).status).toBe(401);
    expect((await call('/api/v1/auth/me')).status).toBe(401);
    expect(seen).toBeUndefined();
    expect((await upgrade('/game')).status).toBe(401);
    expect((await call('/', { headers: { cookie: `${GATE_COOKIE}=forjado` } })).status).toBe(401);
  });

  it('turns the secret link into a Secure HttpOnly cookie and drops the token from the URL', async () => {
    const res = await call(`/art.html?${ACCESS_PARAM}=${TOKEN}`, { headers: { 'cf-connecting-ip': '203.0.113.9' } });
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/art.html');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    const cookie = res.headers['set-cookie'][0];
    expect(cookie).toMatch(new RegExp(`^${GATE}; `));
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).not.toContain(TOKEN);
  });

  it('limits wrong links per client IP', async () => {
    const from = { 'cf-connecting-ip': '198.51.100.7' };
    for (let i = 0; i < 20; i++) expect((await call(`/?${ACCESS_PARAM}=x${i}`, { headers: from })).status).toBe(401);
    expect((await call(`/?${ACCESS_PARAM}=${TOKEN}`, { headers: from })).status).toBe(429);
    expect((await call(`/?${ACCESS_PARAM}=${TOKEN}`, { headers: { 'cf-connecting-ip': '198.51.100.8' } })).status).toBe(
      303,
    );
  });
});

describe('routes', () => {
  const get = (path) => call(path, { headers: { cookie: GATE } });

  it('serves the built pages with a CSP and only catalog GLBs', async () => {
    const page = await get('/');
    expect(page.status).toBe(200);
    expect(page.headers['content-security-policy']).toContain(`connect-src 'self' blob: wss://${HOST}`);
    expect(page.headers['content-security-policy']).not.toContain("'unsafe-eval'");
    expect(page.headers['x-frame-options']).toBe('DENY');
    expect((await get('/assets/app.js')).status).toBe(200);
    expect((await get('/art-assets/pack/a.glb')).headers['content-type']).toBe('model/gltf-binary');
    expect((await get('/art-assets/catalog.json')).status).toBe(200);
  });

  it('exposes nothing else', async () => {
    for (const p of [
      '/.secret',
      '/art-assets/report.json',
      '/ready',
      '/@vite/client',
      '/%2e%2e/art/report.json',
      '/assets/../.secret',
    ])
      expect((await get(p)).status, p).toBe(404);
    expect((await call('/', { method: 'POST', headers: { cookie: GATE } })).status).toBe(405);
  });
});

describe('API proxy', () => {
  it('forwards GET /health (client status line) and nothing else outside /api', async () => {
    expect((await call('/health', { headers: { cookie: GATE } })).status).toBe(200);
    expect(seen.url).toBe('/health');
  });

  it('forwards /api with one client IP, the session cookie and without the gate cookie', async () => {
    const res = await call('/api/v1/auth/me', {
      headers: {
        cookie: `${GATE}; __Host-bar_sid=abc`,
        'x-forwarded-for': '1.2.3.4',
        'cf-connecting-ip': '203.0.113.5',
      },
    });
    expect(res.status).toBe(200);
    expect(res.headers['set-cookie']).toEqual(['__Host-bar_sid=s; Path=/; Secure']);
    expect(seen.headers['x-forwarded-for']).toBe('203.0.113.5'); // spoofed XFF dropped; tunnel header trusted on loopback
    expect(seen.headers['x-forwarded-proto']).toBe('https');
    expect(seen.headers.cookie).toBe('__Host-bar_sid=abc');
    expect(seen.headers['cf-connecting-ip']).toBeUndefined();
  });

  it('forwards the game WebSocket upgrade only on /game, keeping Origin and session', async () => {
    const res = await upgrade('/game/abc?sessionId=1', {
      cookie: `${GATE}; __Host-bar_sid=abc`,
      origin: `https://${HOST}`,
    });
    expect(res.status).toBe(101);
    expect(seen.url).toBe('/game/abc?sessionId=1');
    expect(seen.headers.origin).toBe(`https://${HOST}`);
    expect(seen.headers.cookie).toBe('__Host-bar_sid=abc');
    expect((await upgrade('/other', { cookie: GATE })).status).toBe(404);
  });
});
