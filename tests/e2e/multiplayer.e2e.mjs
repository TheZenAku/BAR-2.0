// Multiplayer E2E (M3) in real browsers: two independent browser contexts (separate cookie jars), two accounts, one
// real server + PostgreSQL, the production client build. Checks presence, replication of movement/locomotion,
// server-side collision as seen by the other player, reconnection after a dropped socket and logout leaving the room.
// Usage: npm run test:e2e (runs after boot.e2e.mjs) or node tests/e2e/multiplayer.e2e.mjs
//   env BAR_E2E_BROWSER=msedge|chromium|firefox (default msedge)
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, firefox } from 'playwright';
import { preview } from 'vite';
import { createTestDatabase, freePort, startPostgres } from '../support/postgres.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const OUT = join(ROOT, 'tests/e2e/output');
const browserName = process.env.BAR_E2E_BROWSER ?? 'msedge';

const failures = [];
const check = (ok, what, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(what);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const pg = await startPostgres({ name: 'pg-e2e' });
const database = await createTestDatabase(pg.adminUrl, 'e2emp');
const apiPort = await freePort();
const webPort = await freePort();
const api = spawn(process.execPath, ['apps/server/src/main.ts'], {
  cwd: ROOT,
  env: {
    ...process.env,
    NODE_ENV: 'test',
    PORT: String(apiPort),
    LOG_LEVEL: 'warn',
    DATABASE_URL: database.url,
    ALLOWED_ORIGINS: `http://127.0.0.1:${webPort}`,
    MAIL_TRANSPORT: 'disabled',
  },
  stdio: ['ignore', 'ignore', 'inherit'],
});
let apiReady = false;
for (let i = 0; i < 150 && !apiReady; i++) {
  try {
    apiReady = (await fetch(`http://127.0.0.1:${apiPort}/ready`)).ok;
  } catch {}
  if (!apiReady) await sleep(100);
}
check(apiReady, 'servidor pronto');

process.env.BAR_SERVER_URL = `http://127.0.0.1:${apiPort}`;
const web = await preview({
  root: join(ROOT, 'apps/client'),
  logLevel: 'warn',
  preview: { host: '127.0.0.1', port: webPort, strictPort: true },
});
const url = `${web.resolvedUrls.local[0]}?gfx=low`;
const browser =
  browserName === 'firefox'
    ? await firefox.launch({ firefoxUserPrefs: { 'webgl.force-enabled': true } })
    : await chromium.launch({
        channel: browserName === 'chromium' ? undefined : browserName,
        args: ['--enable-gpu', '--ignore-gpu-blocklist'],
      });

const errors = [];
async function player(label) {
  const context = await browser.newContext({ viewport: { width: 960, height: 540 } });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`${label} pageerror: ${e.message}`));
  page.on('console', (m) => {
    const expected401 = m.location().url.includes('/api/v1/auth/') && m.text().includes('401');
    if (m.type() === 'error' && !expected401) errors.push(`${label} console: ${m.text().slice(0, 200)}`);
  });
  const account = {
    displayName: `Jogador ${label}`,
    email: `mp-${label.toLowerCase()}-${Date.now()}@example.com`,
    password: `senha longa ${label} e2e`,
  };
  await page.goto(url);
  await page.waitForSelector('#auth-form', { state: 'visible', timeout: 30000 });
  await page.click('button[data-mode="register"]');
  await page.fill('#auth-displayName', account.displayName);
  await page.fill('#auth-email', account.email);
  await page.fill('#auth-newPassword', account.password);
  await page.click('#auth-submit');
  await page.waitForFunction(() => window.__bar?.ready === true, null, { timeout: 60000 });
  return { label, page, account, snap: () => page.evaluate(() => window.__bar.snapshot()) };
}
const until = (p, fn, arg, timeout = 5000) =>
  p.page.waitForFunction(fn, arg, { timeout, polling: 100 }).then(
    () => true,
    () => false,
  );
const netIs = (p, players) =>
  until(
    p,
    (n) => {
      const s = window.__bar?.snapshot().net;
      return s?.status === 'online' && s.players === n && s.remotes.length === n - 1;
    },
    players,
  );
const remoteOf = async (viewer) => (await viewer.snap()).net.remotes[0];
/** Polls from Node (not inside the page): background pages throttle their own timers. */
async function seen(viewer, pred, timeout = 3000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const r = await remoteOf(viewer);
    if (r && pred(r)) return true;
    await sleep(50);
  }
  return false;
}
const metrics = { browser: `${browserName} ${browser.version()}`, date: new Date().toISOString() };

try {
  const a = await player('A');
  const b = await player('B');
  check(await netIs(a, 2), 'A online vê 2 jogadores');
  check(await netIs(b, 2), 'B online vê 2 jogadores');
  check(
    (await b.page.textContent('#net-status')).includes('2/16'),
    'indicador de conexão',
    await b.page.textContent('#net-status'),
  );
  check((await remoteOf(b)).name === a.account.displayName, 'B vê o nome de A', (await remoteOf(b)).name);
  await sleep(500);

  // A walks forward (camera yaw 0 → -Z): B must see the motion and the walk animation, then run.
  const z0 = (await remoteOf(b)).position.z;
  await a.page.bringToFront();
  await a.page.keyboard.down('KeyW');
  check(await seen(b, (r) => r.animation === 'walk'), 'B vê A andando (animação walk)');
  await sleep(300);
  const walked = z0 - (await remoteOf(b)).position.z;
  check(walked > 0.5, 'B vê o deslocamento de A', `${walked.toFixed(2)} m`);
  await a.page.keyboard.down('ShiftLeft');
  check(await seen(b, (r) => r.animation === 'run'), 'B vê A correndo (animação run)');
  await sleep(2000); // into the bar counter (front face z = -4.15)
  await a.page.keyboard.up('ShiftLeft');
  await a.page.keyboard.up('KeyW');
  await sleep(600);
  const zMin = -4.15 + 0.3 - 0.02;
  const sa = await a.snap();
  const seenByB = await remoteOf(b);
  check(sa.player.position.z >= zMin, 'colisão: A parado no balcão', `z=${sa.player.position.z.toFixed(3)}`);
  check(seenByB.position.z >= zMin, 'colisão: B vê A parado no balcão', `z=${seenByB.position.z.toFixed(3)}`);
  const gap = Math.hypot(sa.player.position.x - seenByB.position.x, sa.player.position.z - seenByB.position.z);
  check(gap < 0.05, 'posição de A igual nas duas telas (parado)', `${(gap * 100).toFixed(1)} cm`);
  check(seenByB.animation === 'idle', 'B vê A em idle após parar', seenByB.animation);
  metrics.a = { corrections: sa.net.corrections, lastCorrectionCm: sa.net.lastCorrectionCm, rttMs: sa.net.rttMs };
  metrics.b = { snapshotsPerSec: (await b.snap()).net.snapshotsPerSec };
  check(sa.net.snapshotsPerSec >= 15, 'snapshots ~20/s', `${sa.net.snapshotsPerSec}/s`);
  mkdirSync(OUT, { recursive: true });
  await b.page.screenshot({ path: join(OUT, `multiplayer-b-sees-a-${browserName}.png`) });

  // Network drop → automatic reconnection, same identity, B never loses A.
  const pidA = sa.net.you;
  await a.page.evaluate(() => window.__bar.simulateNetworkDrop());
  check(
    await until(a, () => window.__bar.snapshot().net.reconnections === 1, null, 10000),
    'A reconecta automaticamente',
  );
  check(await netIs(a, 2), 'A online de novo com 2 jogadores');
  check((await a.snap()).net.you === pidA, 'mesma identidade na sala após reconectar');
  check((await b.snap()).net.players === 2, 'B continua vendo A');

  // Logout: A leaves the room at once.
  await a.page.click('#logout');
  await a.page.waitForSelector('#auth-form', { state: 'visible' });
  check(await netIs(b, 1), 'logout de A: B fica sozinho na sala');
  check(
    (await b.page.textContent('#net-status')).includes('1/16'),
    'indicador atualizado',
    await b.page.textContent('#net-status'),
  );

  // Login again → back in the room.
  await a.page.fill('#auth-email', a.account.email);
  await a.page.fill('#auth-password', a.account.password);
  await a.page.click('#auth-submit');
  await a.page.waitForFunction(() => window.__bar?.ready === true, null, { timeout: 60000 });
  check(await netIs(a, 2), 'A entra de novo após login');
  check(await netIs(b, 2), 'B vê A voltar');
  check(errors.length === 0, 'sem erros no console/página', errors.join(' | '));
} catch (e) {
  check(false, 'execução', String(e).slice(0, 400));
} finally {
  await browser.close();
  await web.close();
  if (api.exitCode === null) {
    const exited = new Promise((r) => api.once('exit', r));
    api.kill();
    await exited;
  }
  await database.drop().catch((e) => console.warn(`drop test database: ${e}`));
  await pg.stop();
}

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, `metrics-multiplayer-${browserName}.json`), `${JSON.stringify(metrics, null, 2)}\n`);
console.log(JSON.stringify(metrics));
if (failures.length) {
  console.error(`E2E multiplayer: ${failures.length} falha(s)`);
  process.exit(1);
}
console.log('E2E multiplayer: OK');
// Proxied WebSocket sockets of vite preview can keep the event loop alive after close().
process.exit(0);
