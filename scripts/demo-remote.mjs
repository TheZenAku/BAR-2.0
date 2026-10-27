// Remote demo (multiplayer + art gallery) over HTTPS, in one command, without exposing development servers:
//   browser ──https/wss──► Cloudflare quick tunnel ──► gateway 127.0.0.1 (access link, routes, Host) ──► API 127.0.0.1
// - Client: production build of both pages (index.html, art.html) served as static files by the gateway; no Vite.
// - API: NODE_ENV=production (Secure `__Host-` cookies, strict Origin = the tunnel origin, rate limit keyed on the
//   real client IP via TRUST_PROXY), own PostgreSQL cluster (.data/pg-remote, loopback), dev mail disabled.
// - Access: secret link with a random token (.data/remote-access.json, git-ignored); `--new-token` revokes the old.
// - Nothing is changed outside the project: no firewall, router, service or global install. Ctrl+C closes the tunnel.
// Usage: npm run demo:remote                (runs until Ctrl+C)
//        npm run demo:remote -- --smoke     (verifies everything through the public URL and exits)
//        npm run demo:remote -- --local     (no tunnel: gateway at http://127.0.0.1:<port>, for tests/CI)
//        npm run demo:remote -- --new-token (rotates the access token)
//        npm run demo:remote -- --stop      (from another terminal: closes a running remote demo gracefully;
//                                            works on Windows, where Ctrl+C from a parent tool cannot be sent)
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as netServer } from 'node:net';
import { join, resolve } from 'node:path';
import pg from 'pg';
import { freePort, startPostgres } from '../tests/support/postgres.mjs';
import { startQuickTunnel } from './remote/cloudflared.mjs';
import { ACCESS_PARAM, createGateway, GATE_COOKIE } from './remote/gateway.mjs';
import { ensureAccount, loadOrCreateCredentials, verifyRoom, waitFor } from './support/demo-kit.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const SMOKE = process.argv.includes('--smoke');
const LOCAL = process.argv.includes('--local');
const GATEWAY_PORT = Number(process.env.BAR_REMOTE_PORT ?? 8780);
const API_PORT = Number(process.env.BAR_REMOTE_API_PORT ?? 2580);
const DATABASE = 'bar_demo';
const ACCESS_FILE = join(ROOT, '.data', 'remote-access.json');
const STOP_FILE = join(ROOT, '.data', 'remote-stop');
const WEB_OUT = join(ROOT, '.cache/remote/web');
const ART_DIR = join(ROOT, '.cache/assets/generated');
const CATALOG = join(ART_DIR, 'catalog.json');

const step = (msg) => console.log(`[remote] ${msg}`);
const cleanups = [];
let stopping = false;
async function stopAll(code) {
  if (stopping) return;
  stopping = true;
  for (const fn of cleanups.reverse()) await fn().catch((e) => console.error(`[remote] cleanup: ${e.message}`));
  process.exit(code);
}
function fail(what, hint) {
  console.error(`\n[remote] FALHA: ${what}${hint ? `\n[remote] Como resolver: ${hint}` : ''}\n`);
  return stopAll(1);
}
process.on('SIGINT', () => void stopAll(0));
process.on('SIGTERM', () => void stopAll(0));
if (process.argv.includes('--stop')) {
  writeFileSync(STOP_FILE, '');
  console.log('[remote] pedido de encerramento enviado; a demo remota fecha o túnel em até 1 s.');
  process.exit(0);
}
rmSync(STOP_FILE, { force: true });
setInterval(() => {
  if (existsSync(STOP_FILE)) {
    rmSync(STOP_FILE, { force: true });
    step('encerrando (--stop)…');
    void stopAll(0);
  }
}, 1000).unref();
const portFree = (port) =>
  new Promise((res) => {
    const s = netServer()
      .once('error', () => res(false))
      .listen(port, '127.0.0.1', () => s.close(() => res(true)));
  });

// 1. Preconditions.
if (!existsSync(join(ROOT, 'node_modules', 'vite'))) await fail('dependências ausentes', 'execute `npm ci`.');
for (const [port, name] of [
  [GATEWAY_PORT, 'gateway'],
  [API_PORT, 'API'],
]) {
  if (!(await portFree(port)))
    await fail(
      `porta ${port} (${name}) ocupada`,
      'encerre a demo remota anterior ou defina BAR_REMOTE_PORT/BAR_REMOTE_API_PORT.',
    );
}
if (!existsSync(CATALOG)) {
  step('gerando os assets da galeria (fontes oficiais, SHA-256 verificado)…');
  for (const script of ['scripts/assets/fetch.mjs', 'scripts/assets/build.mjs']) {
    if (spawnSync(process.execPath, [script], { cwd: ROOT, stdio: 'inherit' }).status !== 0)
      await fail(`${script} falhou`);
  }
}
const catalog = JSON.parse(readFileSync(CATALOG, 'utf8'));
const artFiles = catalog.candidates.flatMap((c) =>
  [...c.variants, ...c.parts, ...(c.animationLibrary ? [c.animationLibrary] : [])].map((i) => i.file),
);

// 2. Access token (persists across runs so the link survives restarts; --new-token revokes it).
const stored = existsSync(ACCESS_FILE) ? JSON.parse(readFileSync(ACCESS_FILE, 'utf8')) : {};
const token =
  !process.argv.includes('--new-token') && stored.token ? stored.token : randomBytes(24).toString('base64url');

// 3. Production build of the client (both pages), served as static files. No dev server is reachable.
step('gerando build de produção do cliente (multiplayer + galeria)…');
const { build } = await import('vite');
await build({
  root: join(ROOT, 'apps/client'),
  logLevel: 'warn',
  build: {
    outDir: WEB_OUT,
    emptyOutDir: true,
    rollupOptions: { input: { main: join(ROOT, 'apps/client/index.html'), art: join(ROOT, 'apps/client/art.html') } },
  },
});

// 4. Gateway on loopback (public origin set once the tunnel is up).
let origin = `http://127.0.0.1:${GATEWAY_PORT}`;
const gateway = createGateway({
  webRoot: WEB_OUT,
  artRoot: ART_DIR,
  artFiles,
  apiPort: API_PORT,
  token,
  publicOrigin: origin,
});
await new Promise((r) => gateway.server.listen(GATEWAY_PORT, '127.0.0.1', r));
cleanups.push(() => {
  const closed = new Promise((r) => gateway.server.close(() => r()));
  gateway.server.closeAllConnections();
  return closed;
});

// 5. Tunnel (HTTPS, outbound only).
if (!LOCAL) {
  step('abrindo túnel HTTPS (Cloudflare quick tunnel, sem conta)…');
  try {
    const tunnel = await startQuickTunnel(`http://127.0.0.1:${GATEWAY_PORT}`);
    cleanups.push(() => tunnel.stop());
    origin = tunnel.origin;
  } catch (e) {
    await fail(
      `túnel: ${e.message}`,
      'verifique a saída HTTPS (porta 443/7844) desta rede; `--local` testa sem túnel.',
    );
  }
  gateway.setPublicOrigin(origin);
}

// 6. Isolated PostgreSQL and the API in production mode, loopback only.
step('iniciando PostgreSQL isolado (.data/pg-remote)…');
let postgres;
try {
  postgres = await startPostgres({ name: 'pg-remote', port: await freePort(), external: '' });
} catch (e) {
  await fail(`PostgreSQL não iniciou: ${e.message.split('\n')[0]}`, 'veja se outro processo usa .data/pg-remote.');
}
cleanups.push(() => postgres.stop());
const admin = new pg.Client({ connectionString: postgres.adminUrl });
await admin.connect();
if ((await admin.query('select 1 from pg_database where datname = $1', [DATABASE])).rowCount === 0)
  await admin.query(`create database ${pg.escapeIdentifier(DATABASE)}`);
await admin.end();

step('iniciando API (modo production, só loopback)…');
const server = spawn(process.execPath, ['apps/server/src/main.ts'], {
  cwd: ROOT,
  env: {
    ...process.env,
    NODE_ENV: 'production',
    HOST: '127.0.0.1',
    PORT: String(API_PORT),
    LOG_LEVEL: process.env.LOG_LEVEL ?? 'warn',
    DATABASE_URL: postgres.adminUrl.replace(/\/postgres$/, `/${DATABASE}`),
    ALLOWED_ORIGINS: origin,
    PUBLIC_APP_URL: origin,
    TRUST_PROXY: 'true',
    MAIL_TRANSPORT: 'disabled',
  },
  stdio: ['ignore', 'inherit', 'inherit'],
});
cleanups.push(async () => {
  if (server.exitCode !== null) return;
  const exited = new Promise((r) => server.once('exit', r));
  server.kill();
  await exited;
});
server.once('exit', (code) => {
  if (!stopping) void fail(`a API encerrou (código ${code})`, 'veja o erro acima.');
});
if (!(await waitFor(async () => (await fetch(`http://127.0.0.1:${API_PORT}/ready`)).ok, 30_000)))
  await fail('API não ficou pronta em 30 s (/ready)');
const accounts = loadOrCreateCredentials();
try {
  for (const a of accounts)
    await ensureAccount(a, {
      apiBase: `http://127.0.0.1:${API_PORT}`,
      origin,
      adminUrl: postgres.adminUrl,
      database: DATABASE,
    });
} catch (e) {
  await fail(`contas de demonstração: ${e.message}`);
}

// 7. Verify through the public URL, exactly as a remote browser would reach it.
step(`verificando pela URL pública ${origin} …`);
const accessUrl = `${origin}/?${ACCESS_PARAM}=${token}`;
const checks = [];
const check = (ok, what) => {
  checks.push({ ok, what });
  if (!ok) console.error(`[remote] FALHOU: ${what}`);
};
try {
  if (!(await waitFor(async () => (await fetch(`${origin}/`)).status === 401, 90_000)))
    throw new Error('a URL pública não respondeu em 90 s');
  check((await fetch(`${origin}/?${ACCESS_PARAM}=errado`)).status === 401, 'link com token errado → 401');
  const entry = await fetch(accessUrl, { redirect: 'manual' });
  const gateCookie = entry.headers
    .getSetCookie()
    .find((c) => c.startsWith(`${GATE_COOKIE}=`))
    ?.split(';')[0];
  check(entry.status === 303 && Boolean(gateCookie), 'link de acesso → cookie do gateway');
  const get = (path, cookie = gateCookie) => fetch(`${origin}${path}`, { headers: cookie ? { cookie } : {} });
  check((await get('/', '')).status === 401, 'sem cookie de acesso → 401');
  const page = await get('/');
  check(page.status === 200 && (await page.text()).includes('<canvas'), 'cliente multiplayer (build de produção)');
  check((await get('/art.html')).status === 200, 'galeria');
  const glb = await get(`/art-assets/${artFiles[0]}`);
  check(glb.status === 200 && (await glb.arrayBuffer()).byteLength > 1000, 'GLB da galeria');
  check((await get('/health')).status === 200, '/health (status do cliente)');
  for (const p of ['/ready', '/art-assets/report.json', '/.data/demo-accounts.json', '/src/main.ts', '/@vite/client'])
    check((await get(p)).status === 404, `${p} não exposto`);
  const evil = await fetch(`${origin}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://evil.example', cookie: gateCookie },
    body: JSON.stringify({ email: accounts[0].email, password: accounts[0].password }),
  });
  check(evil.status === 403, 'login com Origin estranha → 403');
  const login = await fetch(`${origin}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin, cookie: gateCookie },
    body: JSON.stringify({ email: accounts[0].email, password: accounts[0].password }),
  });
  const sid = login.headers.getSetCookie().find((c) => c.startsWith('__Host-bar_sid=')) ?? '';
  check(
    login.status === 200 && /;\s*Secure/i.test(sid) && /HttpOnly/i.test(sid),
    'sessão em cookie __Host- Secure HttpOnly',
  );
  await fetch(`${origin}/api/v1/auth/logout`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin, cookie: `${gateCookie}; ${sid.split(';')[0]}` },
    body: '{}',
  });
  await verifyRoom(origin, accounts, gateCookie);
  check(
    true,
    `multiplayer: ${accounts.length} contas na mesma sala via ${origin.startsWith('https') ? 'wss' : 'ws'}://`,
  );
} catch (e) {
  check(false, e.message);
}
if (checks.some((c) => !c.ok)) await fail(`${checks.filter((c) => !c.ok).length} verificação(ões) falharam`);
step(`${checks.length} verificações OK pela URL pública.`);
writeFileSync(
  ACCESS_FILE,
  `${JSON.stringify({ token, accessUrl: LOCAL ? null : accessUrl, startedAt: new Date().toISOString() }, null, 2)}\n`,
  { mode: 0o600 },
);

console.log(`
============================ B.A.R. — DEMO REMOTA (HTTPS) ============================
Link de acesso (SECRETO — envie só a quem deve entrar; vale até Ctrl+C):
  ${accessUrl}
Depois de abrir o link: multiplayer em ${origin}/  ·  galeria em ${origin}/art.html
Contas descartáveis: ${accounts.map((a) => a.email).join(', ')} — senhas em .data/demo-accounts.json
O link também fica em .data/remote-access.json. Nova URL a cada execução; --new-token revoga o token.
Ctrl+C (ou npm run demo:remote -- --stop) encerra túnel, API e PostgreSQL desta demo; as demos locais seguem.
======================================================================================
`);
if (SMOKE) {
  step('smoke: OK');
  await stopAll(0);
}
