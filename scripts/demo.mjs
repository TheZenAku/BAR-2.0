// Local demo in one command: isolated PostgreSQL (.data/pg-demo, loopback only) + backend + Vite dev client, plus
// two disposable demo accounts. Never reads .env or DATABASE_URL, so it cannot touch any other database.
// The demo passwords are random, generated once per machine and kept in .data/demo-accounts.json (git-ignored).
// Usage: npm run demo            (runs until Ctrl+C)
//        npm run demo -- --smoke (starts, checks every step, stops; exit code 1 on failure)
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer as netServer } from 'node:net';
import { join, resolve } from 'node:path';
import pg from 'pg';
import { freePort, startPostgres } from '../tests/support/postgres.mjs';
import { ensureAccount, loadOrCreateCredentials, verifyRoom, waitFor } from './support/demo-kit.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const SMOKE = process.argv.includes('--smoke');
const API_PORT = Number(process.env.BAR_DEMO_API_PORT ?? 2567);
const WEB_PORT = Number(process.env.BAR_DEMO_WEB_PORT ?? 5173);
const DATABASE = 'bar_demo';
const WEB_ORIGINS = [`http://127.0.0.1:${WEB_PORT}`, `http://localhost:${WEB_PORT}`];
const step = (msg) => console.log(`[demo] ${msg}`);
const cleanups = [];
let stopping = false;

async function stopAll(code) {
  if (stopping) return;
  stopping = true;
  for (const fn of cleanups.reverse()) await fn().catch((e) => console.error(`[demo] cleanup: ${e.message}`));
  process.exit(code);
}

function fail(what, hint) {
  console.error(`\n[demo] FALHA: ${what}${hint ? `\n[demo] Como resolver: ${hint}` : ''}\n`);
  return stopAll(1);
}

const portFree = (port) =>
  new Promise((res) => {
    const s = netServer()
      .once('error', () => res(false))
      .listen(port, '127.0.0.1', () => s.close(() => res(true)));
  });

process.on('SIGINT', () => void stopAll(0));
process.on('SIGTERM', () => void stopAll(0));

// 1. Preconditions with actionable diagnostics.
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 24 || (major === 24 && minor < 7))
  await fail(`Node ${process.version} (exige >= 24.7)`, 'instale Node 24 LTS.');
if (!existsSync(join(ROOT, 'node_modules', 'vite'))) await fail('dependências ausentes', 'execute `npm ci`.');
for (const [port, name] of [
  [API_PORT, 'API'],
  [WEB_PORT, 'cliente web'],
]) {
  if (!(await portFree(port)))
    await fail(
      `porta ${port} (${name}) ocupada`,
      'encerre o processo que a usa (ex.: `npm run dev:server`/`dev:client` em outro terminal) ou defina BAR_DEMO_API_PORT/BAR_DEMO_WEB_PORT.',
    );
}

// 2. Isolated PostgreSQL: its own cluster, loopback only, its own database.
step('iniciando PostgreSQL de demonstração (.data/pg-demo)…');
let postgres;
try {
  postgres = await startPostgres({ name: 'pg-demo', port: await freePort(), external: '' });
} catch (e) {
  await fail(`PostgreSQL não iniciou: ${e.message.split('\n')[0]}`, 'veja se outro processo usa .data/pg-demo.');
}
cleanups.push(() => postgres.stop());
const admin = new pg.Client({ connectionString: postgres.adminUrl });
await admin.connect();
if ((await admin.query('select 1 from pg_database where datname = $1', [DATABASE])).rowCount === 0)
  await admin.query(`create database ${pg.escapeIdentifier(DATABASE)}`);
await admin.end();
step('PostgreSQL pronto.');

// 3. Backend (migrations at startup). Configuration is explicit: nothing comes from .env.
step(`iniciando API em http://127.0.0.1:${API_PORT}…`);
const server = spawn(process.execPath, ['apps/server/src/main.ts'], {
  cwd: ROOT,
  env: {
    ...process.env,
    NODE_ENV: 'development',
    HOST: '127.0.0.1',
    PORT: String(API_PORT),
    LOG_LEVEL: process.env.LOG_LEVEL ?? 'warn',
    DATABASE_URL: postgres.adminUrl.replace(/\/postgres$/, `/${DATABASE}`),
    ALLOWED_ORIGINS: WEB_ORIGINS.join(','),
    PUBLIC_APP_URL: WEB_ORIGINS[0],
    MAIL_TRANSPORT: 'dev-outbox',
    COOKIE_SECURE: 'false',
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
  await fail('API não ficou pronta em 30 s (/ready)', 'veja os logs acima.');
step('API pronta (/ready: banco acessível).');

// 4. Demo accounts (idempotent).
const accounts = loadOrCreateCredentials();
try {
  for (const a of accounts)
    await ensureAccount(a, {
      apiBase: `http://127.0.0.1:${API_PORT}`,
      origin: WEB_ORIGINS[0],
      adminUrl: postgres.adminUrl,
      database: DATABASE,
    });
} catch (e) {
  await fail(`contas de demonstração: ${e.message}`);
}
step('contas de demonstração prontas.');

// 5. Vite dev client, proxying /api, /health, /ready and the game WebSocket to the backend.
process.env.BAR_SERVER_URL = `http://127.0.0.1:${API_PORT}`;
const { createServer } = await import('vite');
const web = await createServer({
  root: join(ROOT, 'apps/client'),
  logLevel: 'warn',
  server: { host: '127.0.0.1', port: WEB_PORT, strictPort: true },
});
cleanups.push(() => web.close());
await web.listen();

// 6. Verify every URL that will be printed, through the browser-facing proxy.
const reachable = [];
for (const origin of WEB_ORIGINS) {
  const ok = await waitFor(async () => {
    const [page, health] = await Promise.all([fetch(origin), fetch(`${origin}/health`)]);
    return page.ok && health.ok;
  }, 10_000);
  if (ok) reachable.push(origin);
}
if (reachable.length === 0) await fail('cliente web não respondeu', `verifique a porta ${WEB_PORT}.`);

// 7. Multiplayer through the same proxy a browser uses (both accounts must see each other in the room).
try {
  await verifyRoom(reachable[0], accounts);
} catch (e) {
  await fail(`multiplayer: ${e.message}`, 'veja os logs da API acima.');
}
step('multiplayer verificado: 2 contas na mesma sala via WebSocket.');

console.log(`
================================ B.A.R. — DEMO LOCAL ================================
Abra no navegador: ${reachable.join('   ou   ')}
  (somente nesta máquina; cada URL tem seu próprio cookie de sessão)

Contas descartáveis (somente deste banco local de demonstração):
${accounts.map((a) => `  ${a.displayName.padEnd(10)} e-mail: ${a.email.padEnd(20)} senha: ${a.password}`).join('\n')}

Controles: WASD/setas mover · Shift correr · clique no jogo captura o mouse (Esc solta)
           mouse gira a câmera · roda do mouse: zoom · F3: HUD · ?gfx=low|medium|high na URL
Multiplayer: conta 1 numa janela normal, conta 2 numa janela anônima (ou outro navegador, ou
           a outra URL acima). Canto inferior esquerdo: conexão e nº de jogadores; F3: rede.
Ctrl+C encerra tudo (API, cliente e PostgreSQL de demonstração).
======================================================================================
`);

if (SMOKE) {
  step('smoke: OK');
  await stopAll(0);
}
