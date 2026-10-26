// E2E smoke of the vertical slice in a real browser: real server (/health) + production client build.
// Boots, checks rendering, walks/runs into the bar counter (collision), records frame-time percentiles and
// verifies that disposing the game releases every GPU object.
// Usage: npm run test:e2e   (env BAR_E2E_BROWSER=msedge|chromium|firefox, default msedge;
//   BAR_E2E_GFX=low|medium|high; BAR_E2E_SECONDS=5)
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { chromium, firefox } from 'playwright';
import { preview } from 'vite';

const ROOT = resolve(import.meta.dirname, '../..');
const OUT = join(ROOT, 'tests/e2e/output');
const browserName = process.env.BAR_E2E_BROWSER ?? 'msedge';
const measureSeconds = Number(process.env.BAR_E2E_SECONDS ?? 5);
const gfx = process.env.BAR_E2E_GFX ?? 'medium';
const tag = `${browserName}-${gfx}`;

const failures = [];
const check = (ok, what, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(what);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const freePort = () =>
  new Promise((res, rej) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => res(port));
    });
    s.on('error', rej);
  });

// 1. Real backend.
const apiPort = await freePort();
const api = spawn(process.execPath, ['apps/server/src/main.ts'], {
  cwd: ROOT,
  env: { ...process.env, NODE_ENV: 'test', PORT: String(apiPort), LOG_LEVEL: 'warn' },
  stdio: ['ignore', 'ignore', 'inherit'],
});
for (let i = 0; i < 50; i++) {
  try {
    if ((await fetch(`http://127.0.0.1:${apiPort}/health`)).ok) break;
  } catch {
    await sleep(100);
  }
}

// 2. Production client build served by `vite preview`, proxying /health to the backend.
process.env.BAR_SERVER_URL = `http://127.0.0.1:${apiPort}`;
const web = await preview({
  root: join(ROOT, 'apps/client'),
  logLevel: 'warn',
  preview: { host: '127.0.0.1', port: await freePort(), strictPort: true },
});
const url = web.resolvedUrls.local[0];

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
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 200)}`);
});
const snap = () => page.evaluate(() => window.__bar.snapshot());
const metrics = { browser: `${browserName} ${browser.version()}`, date: new Date().toISOString() };

try {
  const t0 = Date.now();
  await page.goto(`${url}?gfx=${gfx}`);
  await page.waitForFunction(() => window.__bar?.ready === true, null, { timeout: 60000 });
  metrics.bootMs = Date.now() - t0;
  check(true, 'boot', `${metrics.bootMs} ms até a cena pronta`);
  await page.waitForFunction(() => document.querySelector('#status')?.textContent?.includes('protocolo'), null, {
    timeout: 10000,
  });
  check(true, 'status do servidor via /health', await page.textContent('#status'));

  await sleep(800);
  let s = await snap();
  check(s.render.drawCalls > 0 && s.render.triangles > 0, 'renderiza', `${s.render.drawCalls} draw calls`);
  check(s.player.grounded && s.player.locomotion === 'idle', 'avatar parado no chão', JSON.stringify(s.player));

  mkdirSync(OUT, { recursive: true });
  const png = await page.screenshot({ path: join(OUT, `boot-${tag}.png`) });
  // Visual smoke: the frame must not be a flat color (blank canvas / failed WebGL).
  const stddev = await page.evaluate(async (b64) => {
    const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const c = new OffscreenCanvas(bmp.width, bmp.height).getContext('2d');
    c.drawImage(bmp, 0, 0);
    const d = c.getImageData(0, 0, bmp.width, bmp.height).data;
    let sum = 0;
    let sq = 0;
    const n = d.length / 4;
    for (let i = 0; i < d.length; i += 4) {
      const y = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      sum += y;
      sq += y * y;
    }
    return Math.sqrt(sq / n - (sum / n) ** 2);
  }, png.toString('base64'));
  check(stddev > 8, 'screenshot não uniforme', `desvio de luminância ${stddev.toFixed(1)}`);

  // Walk forward (camera yaw 0 → -Z) from spawn z=2 toward the counter.
  // States are polled every frame: fixed sleeps were flaky under VM load (the counter is < 1 s away at 5 m/s).
  const reaches = (state) =>
    page
      .waitForFunction(
        (st) => {
          const x = window.__bar.snapshot();
          return x.player.locomotion === st && x.animation === st;
        },
        state,
        { timeout: 3000, polling: 'raf' },
      )
      .then(
        () => true,
        () => false,
      );
  const z0 = s.player.position.z;
  await page.keyboard.down('KeyW');
  check(await reaches('walk'), 'andar (estado + animação)');
  await sleep(800);
  s = await snap();
  check(z0 - s.player.position.z > 1, 'deslocamento ao andar', `${(z0 - s.player.position.z).toFixed(2)} m`);
  await page.keyboard.down('ShiftLeft');
  check(await reaches('run'), 'correr (estado + animação)');
  await sleep(2500); // keeps pushing into the counter (front face z = -4.15)
  s = await snap();
  const zMin = -4.15 + 0.3 - 0.02;
  check(s.player.position.z >= zMin, 'colisão com o balcão', `z=${s.player.position.z.toFixed(3)} (mín ${zMin})`);
  check(s.player.locomotion === 'idle', 'empurrando parede = idle', s.player.locomotion);
  await page.keyboard.up('ShiftLeft');
  await page.keyboard.up('KeyW');

  // Frame-time window while idle.
  await page.evaluate(() => window.__bar.resetStats());
  await sleep(measureSeconds * 1000);
  s = await snap();
  metrics.frame = s.frame;
  metrics.cpuMs = s.cpuMs;
  metrics.simAvgMs = s.simAvgMs;
  metrics.render = s.render;
  metrics.heapMB = s.heapMB;
  metrics.profile = s.profile;
  metrics.droppedTicks = s.droppedTicks;
  check(s.frame.frames > 0, 'métricas de frame', `p95 ${s.frame.p95Ms.toFixed(2)} ms, ${s.frame.fps.toFixed(1)} FPS`);

  const leaked = await page.evaluate(() => window.__bar.dispose());
  metrics.afterDispose = leaked;
  // Three.js keeps one module-level DFG LUT texture shared by all PBR materials (getDFGLUT); it is not ours.
  const SHARED_THREE_TEXTURES = 1;
  check(
    leaked.geometries === 0 && leaked.textures === SHARED_THREE_TEXTURES,
    'dispose libera GPU',
    `${JSON.stringify(leaked)} (esperado 0 geometrias, ${SHARED_THREE_TEXTURES} textura compartilhada do Three)`,
  );
  await page.keyboard.press('KeyW'); // listeners must be gone: must not throw
  await sleep(200);
  check(errors.length === 0, 'sem erros no console/página', errors.join(' | '));
} catch (e) {
  check(false, 'execução', String(e).slice(0, 400));
} finally {
  await browser.close();
  await web.close();
  api.kill();
}

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, `metrics-${tag}.json`), `${JSON.stringify(metrics, null, 2)}\n`);
console.log(JSON.stringify(metrics));
if (failures.length) {
  console.error(`E2E: ${failures.length} falha(s)`);
  process.exit(1);
}
console.log('E2E: OK');
