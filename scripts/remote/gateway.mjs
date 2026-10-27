// Remote-access gateway (scripts/demo-remote.mjs): the only listener a tunnel reaches. Loopback only.
// - Access gate: every request needs the access cookie, obtained once through the secret link `/?acesso=<token>`
//   (timing-safe comparison; failed attempts limited per client IP). Without it: 401, nothing else is revealed.
// - Host allowlist: only the public hostname (blocks DNS rebinding and unknown front doors).
// - Fixed routes: built client files (no dev server), the generated GLBs listed in the catalog, `/api/*` and the
//   game WebSocket `/game` and `GET /health` (version/uptime for the client's status line) proxied to the API on
//   loopback. Everything else (/ready, dotfiles, .data, sources, dev server paths) is 404.
// - Client IP: X-Forwarded-For is overwritten with one address (the API trusts it for rate limiting).
import { createHmac, timingSafeEqual } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { connect } from 'node:net';
import { join, relative, sep } from 'node:path';

export const GATE_COOKIE = '__Host-bar_gate';
export const ACCESS_PARAM = 'acesso';
const GATE_MAX_AGE_S = 12 * 3600;
const FAIL_WINDOW_MS = 10 * 60_000;
const FAIL_LIMIT = 20;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.glb': 'model/gltf-binary',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};
const typeOf = (p) => TYPES[p.slice(p.lastIndexOf('.'))] ?? 'application/octet-stream';

/** Value of the access cookie for a token (the token itself never travels after the first request). */
export const gateValue = (token) => createHmac('sha256', token).update('bar-gate-v1').digest('base64url');

const same = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

export function parseCookies(header = '') {
  const out = new Map();
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out.set(part.slice(0, i).trim(), part.slice(i + 1).trim());
  }
  return out;
}

/** Cookie header for the API: the gate cookie is the gateway's business only. */
const withoutGate = (header = '') =>
  header
    .split(';')
    .map((p) => p.trim())
    .filter((p) => p && !p.startsWith(`${GATE_COOKIE}=`))
    .join('; ');

/** One client address: Cloudflare's header only when the connection comes from the local tunnel process. */
export function clientIp(req) {
  const peer = req.socket.remoteAddress ?? '';
  const loopback = peer === '127.0.0.1' || peer === '::1' || peer === '::ffff:127.0.0.1';
  const cf = req.headers['cf-connecting-ip'];
  return loopback && typeof cf === 'string' && /^[0-9a-f.:]{2,45}$/i.test(cf) ? cf : peer;
}

/** Every file under `dir`, keyed by its URL path (`/a/b.js`). Fixed at startup: no path is resolved per request. */
export function fileIndex(dir) {
  const files = new Map();
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) files.set(`/${relative(dir, p).split(sep).join('/')}`, p);
    }
  };
  walk(dir);
  return files;
}

/**
 * @param {{ webRoot: string, artRoot: string, artFiles: string[], apiPort: number, token: string,
 *           publicOrigin: string }} opts  artFiles: catalog-relative paths that may be served under /art-assets/.
 */
export function createGateway({ webRoot, artRoot, artFiles, apiPort, token, publicOrigin }) {
  const web = fileIndex(webRoot);
  const art = new Map(['catalog.json', ...artFiles].map((f) => [`/art-assets/${f}`, join(artRoot, f)]));
  const gate = gateValue(token);
  const failures = new Map(); // ip → timestamps of failed access attempts
  let origin = new URL(publicOrigin);
  const secure = () => origin.protocol === 'https:';
  const csp = () =>
    [
      "default-src 'self'",
      "script-src 'self' 'wasm-unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      `connect-src 'self' blob: ${secure() ? 'wss:' : 'ws:'}//${origin.host}`, // blob: GLTFLoader textures
      "worker-src 'self' blob:",
      "frame-ancestors 'none'",
      "base-uri 'none'",
      "form-action 'self'",
    ].join('; ');
  const baseHeaders = () => ({
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'x-frame-options': 'DENY',
    'cross-origin-opener-policy': 'same-origin',
    ...(secure() ? { 'strict-transport-security': 'max-age=86400' } : {}),
  });

  const limited = (ip) => {
    const now = Date.now();
    const recent = (failures.get(ip) ?? []).filter((t) => now - t < FAIL_WINDOW_MS);
    failures.set(ip, recent);
    return recent.length >= FAIL_LIMIT;
  };
  const recordFailure = (ip) => failures.get(ip)?.push(Date.now()) ?? failures.set(ip, [Date.now()]);
  const hostOk = (req) => req.headers.host === origin.host;
  const authorized = (req) => {
    const v = parseCookies(req.headers.cookie).get(GATE_COOKIE);
    return v !== undefined && same(v, gate);
  };

  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, { ...baseHeaders(), 'content-type': 'text/plain; charset=utf-8', ...headers });
    res.end(body);
  };

  const forwardHeaders = (req) => {
    const h = { ...req.headers };
    for (const k of Object.keys(h)) if (k.startsWith('cf-') || k === 'forwarded' || k === 'x-real-ip') delete h[k];
    h['x-forwarded-for'] = clientIp(req);
    h['x-forwarded-proto'] = origin.protocol.slice(0, -1);
    h['x-forwarded-host'] = origin.host;
    const cookie = withoutGate(req.headers.cookie);
    if (cookie) h.cookie = cookie;
    else delete h.cookie;
    return h;
  };

  const proxy = (req, res) => {
    const up = request(
      { host: '127.0.0.1', port: apiPort, method: req.method, path: req.url, headers: forwardHeaders(req) },
      (r) => {
        res.writeHead(r.statusCode ?? 502, { ...r.headers, ...baseHeaders() });
        r.pipe(res);
      },
    );
    up.on('error', () => (res.headersSent ? res.destroy() : send(res, 502, 'API indisponível')));
    req.pipe(up);
  };

  const server = createServer((req, res) => {
    if (!hostOk(req)) return send(res, 421, 'Host não reconhecido');
    const url = new URL(req.url ?? '/', origin);
    const ip = clientIp(req);
    if (url.searchParams.has(ACCESS_PARAM)) {
      if (limited(ip)) return send(res, 429, 'Muitas tentativas. Aguarde alguns minutos.');
      if (!same(url.searchParams.get(ACCESS_PARAM), token)) {
        recordFailure(ip);
        return send(res, 401, 'Link de acesso inválido.');
      }
      url.searchParams.delete(ACCESS_PARAM);
      const attrs = `Path=/; HttpOnly; SameSite=Lax; Max-Age=${GATE_MAX_AGE_S}${secure() ? '; Secure' : ''}`;
      return send(res, 303, '', {
        location: `${url.pathname}${url.search}`,
        'set-cookie': `${GATE_COOKIE}=${gate}; ${attrs}`,
        'cache-control': 'no-store',
      });
    }
    if (!authorized(req)) return send(res, 401, 'Acesso restrito: abra o link de acesso fornecido pelo anfitrião.');
    if (url.pathname.startsWith('/api/') || (url.pathname === '/health' && req.method === 'GET'))
      return proxy(req, res);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Método não permitido');
    const path = url.pathname === '/' ? '/index.html' : url.pathname;
    const file = art.get(path) ?? web.get(path);
    if (!file) return send(res, 404, 'Não encontrado');
    let body;
    try {
      body = readFileSync(file);
    } catch {
      return send(res, 404, 'Não encontrado');
    }
    const html = path.endsWith('.html');
    res.writeHead(200, {
      ...baseHeaders(),
      'content-type': typeOf(path),
      'content-length': body.byteLength,
      'cache-control': html || path.endsWith('.json') ? 'no-store' : 'private, max-age=600',
      ...(html ? { 'content-security-policy': csp() } : {}),
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  });

  server.on('upgrade', (req, socket, head) => {
    const deny = (status, text) =>
      socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    socket.on('error', () => socket.destroy());
    if (!hostOk(req)) return deny(421, 'Misdirected Request');
    if (!authorized(req)) return deny(401, 'Unauthorized');
    const path = new URL(req.url ?? '/', origin).pathname;
    if (path !== '/game' && !path.startsWith('/game/')) return deny(404, 'Not Found');
    const up = connect(apiPort, '127.0.0.1', () => {
      const lines = [`${req.method} ${req.url} HTTP/1.1`];
      for (const [k, v] of Object.entries(forwardHeaders(req))) {
        for (const value of Array.isArray(v) ? v : [v]) lines.push(`${k}: ${value}`);
      }
      up.write(`${lines.join('\r\n')}\r\n\r\n`);
      if (head?.length) up.write(head);
      socket.pipe(up).pipe(socket);
    });
    up.on('error', () => socket.destroy());
    socket.on('close', () => up.destroy());
  });

  return {
    server,
    /** The public origin is known only once the tunnel is up. */
    setPublicOrigin(o) {
      origin = new URL(o);
    },
  };
}
