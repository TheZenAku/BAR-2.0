// Art gallery E2E (M4): the real generated candidates load and animate in a real browser, under both lights,
// with heights normalized; screenshots of each candidate are kept for the human art review (tests/e2e/output).
// Requires npm run assets:build (CI: assets job). Usage: node tests/e2e/art.e2e.mjs  (BAR_E2E_BROWSER as in boot)
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, firefox } from 'playwright';
import { createServer } from 'vite';
import { freePort } from '../support/postgres.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const OUT = join(ROOT, 'tests/e2e/output');
const browserName = process.env.BAR_E2E_BROWSER ?? 'msedge';
if (!existsSync(join(ROOT, '.cache/assets/generated/catalog.json'))) {
  console.error('catálogo ausente: rode npm run assets:fetch && npm run assets:build');
  process.exit(1);
}
const failures = [];
const check = (ok, what, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(what);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const port = await freePort();
const web = await createServer({
  root: join(ROOT, 'apps/client'),
  logLevel: 'warn',
  server: { host: '127.0.0.1', port, strictPort: true },
});
await web.listen();
const browser =
  browserName === 'firefox'
    ? await firefox.launch({ firefoxUserPrefs: { 'webgl.force-enabled': true } })
    : await chromium.launch({
        channel: browserName === 'chromium' ? undefined : browserName,
        args: ['--enable-gpu', '--ignore-gpu-blocklist'],
      });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text().slice(0, 200)}`));
const state = () => page.evaluate(() => window.__art.state());
const settle = () => page.waitForFunction(() => window.__art?.state().actors.length > 0, null, { timeout: 60000 });
mkdirSync(OUT, { recursive: true });

try {
  await page.goto(`http://127.0.0.1:${port}/art.html`);
  await page.waitForFunction(() => window.__art?.ready === true, null, { timeout: 120000 });
  check(true, 'galeria carregada');
  for (const [i, id] of ['kenney-mini', 'kaykit-adventurers', 'quaternius-universal'].entries()) {
    await page.keyboard.press(String(i + 1));
    await settle();
    await sleep(1500);
    let s = await state();
    check(
      s.actors[0]?.candidate === id && s.actors[0].clips > 0,
      `${id}: carregado com animações`,
      `${s.actors[0]?.clips} clipes`,
    );
    const h = s.heights[0];
    check(h > 1.4 && h < 2.4, `${id}: altura normalizada`, `${h} m (referência 1,75 m)`);
    check(s.render.calls > 0 && s.render.triangles > 0, `${id}: renderiza`, `${s.render.calls} draw calls`);
    const p0 = s.actors[0].pose;
    await sleep(300);
    const p1 = (await state()).actors[0].pose;
    check(
      Math.abs(p1 - p0) > 1e-4,
      `${id}: animação move o esqueleto`,
      `${s.actors[0].clip}: Δ ${Math.abs(p1 - p0).toFixed(4)}`,
    );
    await page.screenshot({ path: join(OUT, `art-${id}-bar-light.png`) });
    await page.keyboard.press('p');
    await sleep(400);
    await page.screenshot({ path: join(OUT, `art-${id}-profile.png`) });
    await page.keyboard.press('f');
    await page.keyboard.press('ArrowRight'); // next clip
    await sleep(500);
    s = await state();
    check(s.clip !== '', `${id}: troca de animação`, s.clip);
  }
  await page.keyboard.press('l');
  await page.waitForFunction(() => window.__art.state().actors.length === 3, null, { timeout: 60000 });
  await sleep(1500);
  const lineup = await state();
  check(lineup.actors.length === 3, 'lado a lado com os 3 candidatos', lineup.heights.join(' / '));
  await page.screenshot({ path: join(OUT, 'art-lineup-studio.png') });
  await page.keyboard.press('e'); // bar greybox
  await page.waitForFunction(() => window.__art.state().stage === 'bar', null, { timeout: 30000 });
  await sleep(1500);
  await page.screenshot({ path: join(OUT, 'art-lineup-bar.png') });
  await page.keyboard.press('i'); // next light (night)
  await sleep(500);
  await page.screenshot({ path: join(OUT, 'art-lineup-bar-night.png') });
  for (const mode of ['wire', 'unlit', 'clay', 'pbr']) {
    await page.keyboard.press('m');
    await sleep(200);
    check((await state()).material === mode, `material ${mode}`);
  }
  check(errors.length === 0, 'sem erros no console/página', errors.join(' | '));
} catch (e) {
  check(false, 'execução', String(e).slice(0, 400));
} finally {
  await browser.close();
  await web.close();
}
if (failures.length) {
  console.error(`E2E galeria: ${failures.length} falha(s)`);
  process.exit(1);
}
console.log('E2E galeria: OK');
process.exit(0);
