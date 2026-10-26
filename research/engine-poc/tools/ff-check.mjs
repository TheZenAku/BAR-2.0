// Diagnostic: Babylon on Firefox with shadows off/on. Usage: node tools/ff-check.mjs <poc dir> <screenshot dir>
import { firefox } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
const root = join(process.argv[2], 'dist');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.glb': 'model/gltf-binary' };
const s = createServer((q, r) => { const f = join(root, decodeURIComponent(new URL(q.url, 'http://x').pathname)); if (!existsSync(f)) return r.writeHead(404).end(); r.writeHead(200, { 'content-type': M[extname(f)] ?? 'application/octet-stream' }).end(readFileSync(f)); });
await new Promise((r) => s.listen(0, '127.0.0.1', r));
const b = await firefox.launch();
for (const sh of [0, 1]) {
  const p = await b.newPage({ viewport: { width: 640, height: 360 } });
  const logs = []; p.on('console', (m) => logs.push(m.type() + ': ' + m.text().slice(0, 160)));
  await p.goto(`http://127.0.0.1:${s.address().port}/babylon/babylon.html?n=4&shadows=${sh}`);
  await p.waitForTimeout(8000);
  await p.screenshot({ path: `${process.argv[3]}/bab-ff-sh${sh}.png` });
  console.log('shadows', sh, logs.filter((l) => !l.startsWith('log')).slice(0, 6));
  await p.close();
}
await b.close(); s.close();
