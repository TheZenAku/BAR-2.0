// Server tick micro-benchmark (no network): N players in one GameWorld fed 1 input/tick, as in a real room.
// Reports tick time percentiles and correlates slow ticks with V8 GC pauses, to explain isolated spikes.
// Usage: node scripts/bench-tick.mjs [players=16] [ticks=3600]
import { PerformanceObserver } from 'node:perf_hooks';
import { GREYBOX_BAR, loadRapier } from '@bar/game-core';
import { GameWorld } from '../apps/server/src/game/world.ts';

const players = Number(process.argv[2] ?? 16);
const ticks = Number(process.argv[3] ?? 3600);
const gcs = [];
new PerformanceObserver((list) => {
  for (const e of list.getEntries())
    gcs.push({ start: e.startTime, end: e.startTime + e.duration, kind: e.detail?.kind });
}).observe({ entryTypes: ['gc'] });

const rapier = await loadRapier();
if (process.env.WARMUP) {
  const w = new GameWorld(rapier, GREYBOX_BAR);
  const wp = [w.add({ userId: 'w', publicId: 'w', displayName: 'w' })];
  for (let t = 0; t < Number(process.env.WARMUP); t++) {
    wp[0].enqueue([[t, 1, Math.sin(t / 20), t % 120 < 60, t / 50]]);
    w.step();
    w.snapshotFor(wp[0], w.remoteStates());
  }
  w.dispose();
}
const world = new GameWorld(rapier, GREYBOX_BAR);
const ps = Array.from({ length: players }, (_, i) =>
  world.add({ userId: `u${i}`, publicId: `p${i}`, displayName: `P${i}` }),
);
const times = [];
const slow = [];
let seq = 0;
for (let t = 0; t < ticks; t++) {
  for (const [i, p] of ps.entries()) p.enqueue([[seq, 1, Math.sin((t + i) / 40), t % 240 < 120, (t + i * 30) / 90]]);
  seq++;
  const t0 = performance.now();
  world.step();
  const snaps = world.remoteStates();
  for (const p of ps) world.snapshotFor(p, snaps);
  const t1 = performance.now();
  times.push(t1 - t0);
  if (t1 - t0 > 4) slow.push({ tick: t, ms: t1 - t0, t0, t1 });
}
await new Promise((r) => setTimeout(r, 50));
const sorted = [...times].sort((a, b) => a - b);
const pct = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))].toFixed(3);
const firstSecond = times.slice(0, 60).reduce((a, b) => a + b, 0) / 60;
const rest = times.slice(60).reduce((a, b) => a + b, 0) / Math.max(1, times.length - 60);
const withGc = slow.filter((s) => gcs.some((g) => g.start < s.t1 && g.end > s.t0));
console.log(
  JSON.stringify({
    players,
    ticks,
    avgFirst60: firstSecond.toFixed(3),
    avgAfter: rest.toFixed(3),
    p50: pct(0.5),
    p99: pct(0.99),
    max: sorted.at(-1).toFixed(2),
    slowTicksOver4ms: slow.length,
    slowWithGc: withGc.length,
    slowest: slow
      .sort((a, b) => b.ms - a.ms)
      .slice(0, 5)
      .map((s) => `${s.tick}:${s.ms.toFixed(1)}ms`),
    gcPauses: gcs.length,
    gcMaxMs: Math.max(0, ...gcs.map((g) => g.end - g.start)).toFixed(2),
  }),
);
world.dispose();
