// Runs the built POCs (dist/) in a real browser via Playwright and collects metrics.
// Usage: node tools/bench.mjs [--browser=msedge|chromium|firefox] [--reps=2] [--headed] [--uncapped]
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { gzipSync } from 'node:zlib';
import { chromium, firefox } from 'playwright';

const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const flag = (k) => process.argv.includes(`--${k}`);
const browserName = arg('browser', 'msedge');
const reps = Number(arg('reps', 2));
const uncapped = flag('uncapped');
const cases = [
  { n: 1, shadows: 1 }, { n: 16, shadows: 1 }, { n: 48, shadows: 1 }, { n: 48, shadows: 0 },
];
const engines = (arg('engines', 'three,babylon,playcanvas')).split(',');

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm' };
const root = join(process.cwd(), 'dist');
const server = createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
  const file = join(root, path);
  if (!file.startsWith(root) || !existsSync(file)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' }).end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const args = ['--enable-gpu', '--ignore-gpu-blocklist'];
if (uncapped) args.push('--disable-gpu-vsync', '--disable-frame-rate-limit');
const launch = browserName === 'firefox'
  ? () => firefox.launch({ headless: !flag('headed'), firefoxUserPrefs: { 'webgl.force-enabled': true, ...(uncapped ? { 'layout.frame_rate': 0 } : {}) } })
  : () => chromium.launch({ headless: !flag('headed'), channel: browserName === 'chromium' ? undefined : browserName, args });

mkdirSync('results/screens', { recursive: true });
const results = [];
const browser = await launch();
for (let rep = 0; rep < reps; rep++) {
  for (const engine of engines) {
    for (const c of cases) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      const console_ = [];
      page.on('console', (m) => { if (m.type() === 'error') console_.push(m.text().slice(0, 200)); });
      const js = new Set();
      page.on('response', (r) => { if (r.url().endsWith('.js')) js.add(new URL(r.url()).pathname); });
      const url = `http://127.0.0.1:${port}/${engine}/${engine}.html?bench&n=${c.n}&shadows=${c.shadows}`;
      let result;
      try {
        await page.goto(url);
        await page.waitForFunction(() => window.__pocResult, null, { timeout: 90000, polling: 500 });
        result = await page.evaluate(() => window.__pocResult);
        if (rep === 0 && c.n === 16) await page.screenshot({ path: `results/screens/${engine}-${browserName}.png` });
      } catch (e) {
        result = { engine, avatars: c.n, shadows: !!c.shadows, failed: String(e).slice(0, 300) };
      }
      let raw = 0, gz = 0;
      for (const p of js) { const buf = readFileSync(join(root, p)); raw += buf.length; gz += gzipSync(buf, { level: 9 }).length; }
      result = { ...result, browser: browserName, rep, uncapped, jsLoadedKB: Math.round(raw / 1024), jsLoadedGzipKB: Math.round(gz / 1024), jsFiles: js.size, consoleErrors: console_ };
      results.push(result);
      console.log(`${browserName} rep${rep} ${engine} n=${c.n} sh=${c.shadows}: ${result.failed ? 'FAILED ' + result.failed : `fps ${result.fps} p95 ${result.frameMs.p95}ms cpu p95 ${result.cpuMs.p95}ms dc ${result.drawCalls} load ${result.loadMs}ms`}`);
      await page.close();
    }
  }
}
await browser.close();
server.close();
const out = `results/bench-${browserName}${uncapped ? '-uncapped' : ''}.json`;
writeFileSync(out, JSON.stringify(results, null, 1));
console.log('wrote', out);
