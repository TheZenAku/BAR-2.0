// Remote demo E2E: real browsers through the public HTTPS URL of a running `npm run demo:remote` (Cloudflare edge,
// gateway, production build, Secure cookies, wss). Covers the access link, login, shared room, replicated movement,
// logout, the art gallery and CSP violations. Not run in CI (needs a live tunnel).
// Usage: npm run demo:remote   (in another terminal)  →  node tests/e2e/remote.e2e.mjs
//        (reads the link from .data/remote-access.json, or BAR_REMOTE_ACCESS_URL; BAR_E2E_BROWSER as in boot)
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, firefox } from 'playwright';

const ROOT = resolve(import.meta.dirname, '../..');
const ACCESS_FILE = join(ROOT, '.data/remote-access.json');
const accessUrl =
  process.env.BAR_REMOTE_ACCESS_URL ??
  (existsSync(ACCESS_FILE) ? JSON.parse(readFileSync(ACCESS_FILE, 'utf8')).accessUrl : null);
if (!accessUrl) {
  console.error('link ausente: rode npm run demo:remote (ou defina BAR_REMOTE_ACCESS_URL)');
  process.exit(1);
}
const origin = new URL(accessUrl).origin;
const accounts = JSON.parse(readFileSync(join(ROOT, '.data/demo-accounts.json'), 'utf8'));
const browserName = process.env.BAR_E2E_BROWSER ?? 'msedge';
const failures = [];
const check = (ok, what, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(what);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser =
  browserName === 'firefox'
    ? await firefox.launch({ firefoxUserPrefs: { 'webgl.force-enabled': true } })
    : await chromium.launch({
        channel: browserName === 'chromium' ? undefined : browserName,
        args: ['--enable-gpu', '--ignore-gpu-blocklist'],
      });
const errors = [];
async function open(label) {
  const context = await browser.newContext({ viewport: { width: 960, height: 540 } });
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) =>
      window.__csp.push(`${e.violatedDirective} ${e.blockedURI} @ ${e.sourceFile}:${e.lineNumber}`),
    );
  });
  page.on('pageerror', (e) => errors.push(`${label} pageerror: ${e.message}`));
  page.on('response', (r) => {
    if (r.status() >= 400 && label !== 'X' && !r.url().includes('/api/v1/auth/'))
      errors.push(`${label} HTTP ${r.status()} ${r.url()}`);
  });
  page.on('console', (m) => {
    const expected401 = m.location().url.includes('/api/v1/auth/') && m.text().includes('401');
    if (m.type() === 'error' && !expected401 && label !== 'X' && !m.text().startsWith('Failed to load resource'))
      errors.push(`${label} console: ${m.text().slice(0, 200)}`);
  });
  return { context, page };
}
async function player(label, account) {
  const { context, page } = await open(label);
  await page.goto(`${accessUrl}&gfx=low`);
  await page.waitForSelector('#auth-form', { state: 'visible', timeout: 60000 });
  await page.fill('#auth-email', account.email);
  await page.fill('#auth-password', account.password);
  await page.click('#auth-submit');
  await page.waitForFunction(() => window.__bar?.ready === true, null, { timeout: 90000 });
  return { label, context, page, snap: () => page.evaluate(() => window.__bar.snapshot()) };
}
const netIs = (p, n) =>
  p.page
    .waitForFunction(
      (n) => window.__bar?.snapshot().net.status === 'online' && window.__bar.snapshot().net.players === n,
      n,
      {
        timeout: 15000,
        polling: 200,
      },
    )
    .then(
      () => true,
      () => false,
    );

try {
  // Without the link: nothing but the gate.
  const stranger = await open('X');
  const denied = await stranger.page.goto(`${origin}/art.html`);
  check(denied.status() === 401, 'sem o link: 401 (página e galeria fechadas)');
  await stranger.context.close();

  const a = await player('A', accounts[0]);
  check(!a.page.url().includes('acesso='), 'token removido da URL após o link', a.page.url());
  check(a.page.url().startsWith('https://'), 'HTTPS');
  const cookies = await a.context.cookies();
  const sid = cookies.find((c) => c.name === '__Host-bar_sid');
  check(sid?.secure === true && sid.httpOnly === true, 'sessão em cookie __Host- Secure HttpOnly no navegador');
  const b = await player('B', accounts[1]);
  check(await netIs(a, 2), 'A online vê 2 jogadores (wss pelo túnel)');
  check(await netIs(b, 2), 'B online vê 2 jogadores');

  const zOf = async () => (await b.snap()).net.remotes[0]?.position.z;
  const z0 = await zOf();
  await a.page.bringToFront();
  await a.page.keyboard.down('KeyW');
  await sleep(1500);
  await a.page.keyboard.up('KeyW');
  await sleep(800);
  const z1 = await zOf();
  check(
    typeof z0 === 'number' && Math.abs(z1 - z0) > 0.5,
    'movimento de A replicado em B',
    `Δz ${(z1 - z0).toFixed(2)} m`,
  );

  await a.page.click('#logout');
  await a.page.waitForSelector('#auth-form', { state: 'visible' });
  const status = await a.page.evaluate(async () => (await fetch('/api/v1/auth/session')).status);
  check(status === 401, 'logout revoga a sessão no servidor');
  check(await netIs(b, 1), 'B vê A sair da sala');

  // Gallery on the same origin (gate cookie already set in this context).
  await a.page.goto(`${origin}/art.html`);
  await a.page.waitForFunction(() => window.__art?.ready === true, null, { timeout: 180000 });
  for (const [i, id] of ['kenney-mini', 'kaykit-adventurers', 'quaternius-universal'].entries()) {
    await a.page.keyboard.press(String(i + 1));
    const ok = await a.page
      .waitForFunction((id) => window.__art.state().actors[0]?.candidate === id, id, { timeout: 120000 })
      .then(
        () => true,
        () => false,
      );
    const s = await a.page.evaluate(() => window.__art.state());
    check(
      ok && s.actors[0].clips > 0 && s.render.triangles > 0,
      `galeria: ${id} carregado e renderizado`,
      `${s.actors[0]?.clips} clipes`,
    );
  }
  await a.page.keyboard.press('l');
  check(
    await a.page
      .waitForFunction(() => window.__art.state().actors.length === 3, null, { timeout: 120000 })
      .then(
        () => true,
        () => false,
      ),
    'galeria: lado a lado',
  );
  await a.page.keyboard.press('p');
  await a.page.keyboard.press('ArrowRight');
  await a.page.keyboard.press('i');
  await a.page.keyboard.press('e');
  check(
    (await a.page.evaluate(() => window.__art.state().stage)) === 'bar',
    'galeria: controles (perfil, clipe, luz, cenário)',
  );
  const csp = [...(await a.page.evaluate(() => window.__csp)), ...(await b.page.evaluate(() => window.__csp))];
  check(csp.length === 0, 'sem violações de CSP', csp.join(' | '));
  check(errors.length === 0, 'sem erros no console/página', errors.join(' | '));
} catch (e) {
  check(false, 'execução', String(e).slice(0, 400));
} finally {
  await browser.close();
}
if (failures.length) {
  console.error(`E2E remoto: ${failures.length} falha(s)`);
  process.exit(1);
}
console.log('E2E remoto: OK');
