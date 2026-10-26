// Builds each engine POC separately and reports raw/gzip size of the emitted JS.
import { execSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const sizes = {};
for (const engine of ['three', 'babylon', 'playcanvas']) {
  execSync('npx vite build --logLevel warn', { stdio: 'inherit', env: { ...process.env, POC_ENGINE: engine } });
  const dir = join('dist', engine, 'assets');
  const out = { engineJsKB: 0, engineJsGzipKB: 0, rapierJsKB: 0, rapierJsGzipKB: 0 };
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.js'))) {
    const buf = readFileSync(join(dir, f));
    const key = f.startsWith('rapier') ? 'rapier' : 'engine';
    out[key + 'JsKB'] += statSync(join(dir, f)).size / 1024;
    out[key + 'JsGzipKB'] += gzipSync(buf, { level: 9 }).length / 1024;
  }
  sizes[engine] = Object.fromEntries(Object.entries(out).map(([k, v]) => [k, Math.round(v)]));
}
writeFileSync(join('results', 'bundle-sizes.json'), JSON.stringify(sizes, null, 2));
console.log(JSON.stringify(sizes));
