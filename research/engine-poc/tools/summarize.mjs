// Aggregates results/bench-*.json into a Markdown table (median across repetitions).
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';

const median = (xs) => {
  const s = xs.filter((x) => typeof x === 'number').sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round(((s[m - 1] + s[m]) / 2) * 100) / 100;
};
const rows = [];
for (const f of readdirSync('results').filter((f) => /^bench-.*\.json$/.test(f))) {
  const runs = JSON.parse(readFileSync(`results/${f}`, 'utf8'));
  const groups = new Map();
  for (const r of runs) {
    const k = `${r.engine}|${r.avatars}|${r.shadows}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  for (const [, rs] of groups) {
    const ok = rs.filter((r) => !r.failed);
    const r0 = rs[0];
    const pick = (fn) => median(ok.map(fn));
    rows.push({
      set: f.replace(/^bench-|\.json$/g, ''), engine: r0.engine, n: r0.avatars, shadows: r0.shadows ? 'on' : 'off',
      reps: `${ok.length}/${rs.length}`, fps: pick((r) => r.fps), p50: pick((r) => r.frameMs.p50), p95: pick((r) => r.frameMs.p95),
      p99: pick((r) => r.frameMs.p99), cpu50: pick((r) => r.cpuMs.p50), cpu95: pick((r) => r.cpuMs.p95),
      dc: pick((r) => r.drawCalls), heap: pick((r) => r.jsHeapMB), load: pick((r) => r.loadMs), jsGz: pick((r) => r.jsLoadedGzipKB),
      errors: [...new Set(rs.flatMap((r) => [...(r.errors ?? []), ...(r.consoleErrors ?? []), ...(r.failed ? [r.failed] : [])]))].join('; ').slice(0, 120),
    });
  }
}
const order = { three: 0, babylon: 1, playcanvas: 2 };
rows.sort((a, b) => a.set.localeCompare(b.set) || b.shadows.localeCompare(a.shadows) || a.n - b.n || order[a.engine] - order[b.engine]);
const head = '| set | engine | avatars | shadows | ok runs | FPS | frame p50 | frame p95 | frame p99 | CPU p50 | CPU p95 | draw calls | JS heap MB | load ms | JS loaded gz KB | errors |';
const md = [head, head.replace(/[^|]+/g, '---'), ...rows.map((r) =>
  `| ${r.set} | ${r.engine} | ${r.n} | ${r.shadows} | ${r.reps} | ${r.fps} | ${r.p50} | ${r.p95} | ${r.p99} | ${r.cpu50} | ${r.cpu95} | ${r.dc} | ${r.heap ?? 'n/d'} | ${r.load} | ${r.jsGz} | ${r.errors || '—'} |`)].join('\n');
writeFileSync('results/summary.md', `${md}\n`);
console.log(md);
