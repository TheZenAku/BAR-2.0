// Rapier build comparison: package/bundle size, cold init, step cost and cross-runtime bit-exactness.
// Usage (from research/rapier-builds): npm install && node tools/bench.mjs [--reps=5]
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { gzipSync } from 'node:zlib';
import { chromium, firefox } from 'playwright';
import { build } from 'vite';

const reps = Number(process.argv.find((a) => a.startsWith('--reps='))?.split('=')[1] ?? 5);
const BUILDS = { compat: '@dimforge/rapier3d-compat', deterministic: '@dimforge/rapier3d-deterministic-compat' };
const kb = (n) => Math.round(n / 1024);
const gz = (buf) => gzipSync(buf, { level: 9 }).length;

const sizes = {};
for (const [name, pkg] of Object.entries(BUILDS)) {
  const dist = join('node_modules', pkg, 'dist');
  const wasm = readFileSync(join(dist, 'rapier_wasm3d_bg.wasm'));
  const mjs = readFileSync(join(dist, 'rapier.mjs'));
  sizes[name] = { wasmKB: kb(wasm.length), wasmGzipKB: kb(gz(wasm)), mjsKB: kb(mjs.length), mjsGzipKB: kb(gz(mjs)) };
}

await build({ configFile: 'vite.config.mjs', logLevel: 'warn' });
for (const name of Object.keys(BUILDS)) {
  const html = readFileSync(join('dist', `${name}.html`), 'utf8');
  const chunks = [...html.matchAll(/(?:src|href)="\.\/(assets\/[^"]+\.js)"/g)].map((m) => m[1]);
  const bufs = chunks.map((c) => readFileSync(join('dist', c)));
  sizes[name].bundleKB = kb(bufs.reduce((s, b) => s + b.length, 0));
  sizes[name].bundleGzipKB = kb(bufs.reduce((s, b) => s + gz(b), 0));
}

const runs = [];
for (const [name, pkg] of Object.entries(BUILDS)) {
  for (let r = 0; r < reps; r++) {
    const out = execFileSync(process.execPath, ['src/node-run.mjs', pkg], { encoding: 'utf8' });
    runs.push({ build: name, runtime: `node ${process.version}`, rep: r, ...JSON.parse(out) });
  }
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm' };
const root = join(process.cwd(), 'dist');
const server = createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^[/\\]+/, '');
  const file = join(root, path);
  if (!file.startsWith(root) || !existsSync(file)) return res.writeHead(404).end();
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const browsers = [
  ['msedge', () => chromium.launch({ channel: 'msedge' })],
  ['firefox', () => firefox.launch()],
];
for (const [label, launch] of browsers) {
  let browser;
  try {
    browser = await launch();
  } catch (e) {
    runs.push({ runtime: label, failed: String(e).slice(0, 200) });
    continue;
  }
  const runtime = `${label} ${browser.version()}`;
  for (const name of Object.keys(BUILDS)) {
    for (let r = 0; r < reps; r++) {
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${port}/${name}.html`);
      await page.waitForFunction(() => window.__result, null, { timeout: 60000 });
      runs.push({ build: name, runtime, rep: r, ...(await page.evaluate(() => window.__result)) });
      await page.close();
    }
  }
  await browser.close();
}
server.close();

const median = (xs) => xs.toSorted((a, b) => a - b)[Math.floor(xs.length / 2)];
const summary = {};
for (const run of runs.filter((r) => r.build)) {
  const k = `${run.build} | ${run.runtime}`;
  summary[k] ??= { initMs: [], stepAvgMs: [], stepP95Ms: [], hashes: new Set() };
  for (const m of ['initMs', 'stepAvgMs', 'stepP95Ms']) summary[k][m].push(run[m]);
  summary[k].hashes.add(run.hash);
}
const table = Object.entries(summary).map(([k, v]) => ({
  case: k,
  initMsMedian: median(v.initMs),
  stepAvgMsMedian: median(v.stepAvgMs),
  stepP95MsMedian: median(v.stepP95Ms),
  hashes: [...v.hashes].join(','),
}));
mkdirSync('results', { recursive: true });
const result = { date: new Date().toISOString(), reps, sizes, table, runs };
writeFileSync('results/results.json', `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ sizes, table }, null, 1));
