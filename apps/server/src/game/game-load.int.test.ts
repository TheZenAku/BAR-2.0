// Progressive load over real WebSockets: 1, 2, 8 and 16 headless clients sending intents like the browser does.
// Prints one `[load]` JSON line per step (recorded in docs/execution/TESTS.md). VM numbers are relative only.
import { GREYBOX_BAR, loadRapier } from '@bar/game-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sleep, TestPlayer, waitUntil } from '../testing/game-client.ts';
import { call, createTestContext, newAccount, type TestContext } from '../testing/harness.ts';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext({
    game: { rapier: await loadRapier(), level: GREYBOX_BAR, maxPlayers: 16, reconnectSeconds: 3 },
  });
});
afterAll(() => ctx.close());

const SECONDS = 3;

describe('load', () => {
  it.each([1, 2, 8, 16])('%i simultaneous players', { timeout: 60_000 }, async (n) => {
    const tokens = await Promise.all(
      Array.from({ length: n }, async () => {
        const res = await call(ctx, 'POST', '/api/v1/auth/register', { body: newAccount('load') });
        return res.sessionToken!;
      }),
    );
    const players = await Promise.all(tokens.map((t) => TestPlayer.join(ctx, t)));
    try {
      await waitUntil('everyone sees everyone', () => players.every((p) => p.roster?.players.length === n), 5000);
      const room = ctx.app.game()!.room();
      room.resetStats();
      const counts = players.map((p) => p.snapshots.length);
      const t0 = performance.now();
      // Each client walks/runs in its own direction, changing every second.
      await Promise.all(
        players.map(async (p, i) => {
          for (let s = 0; s < SECONDS; s++) await p.drive(60, 1, Math.sin(i + s), (i + s) % 2 === 0, i + s);
        }),
      );
      const elapsed = (performance.now() - t0) / 1000;
      const rates = players.map((p, i) => (p.snapshots.length - counts[i]!) / elapsed);
      const stats = room.stats();
      const metrics = {
        players: n,
        seconds: Number(elapsed.toFixed(2)),
        tickAvgMs: Number(stats.avgTickMs.toFixed(3)),
        tickMaxMs: Number(stats.maxTickMs.toFixed(2)),
        snapshotsPerSecMin: Number(Math.min(...rates).toFixed(1)),
        snapshotsPerSecAvg: Number((rates.reduce((a, b) => a + b, 0) / n).toFixed(1)),
        snapshotBytes: Buffer.byteLength(JSON.stringify(players[0]!.last)),
        heapMB: Number((process.memoryUsage().heapUsed / 1048576).toFixed(1)),
      };
      // biome-ignore lint/suspicious/noConsole: these metrics are this test's report (run with --silent=false)
      console.log(`[load] ${JSON.stringify(metrics)}`);
      expect(players.every((p) => !p.ended)).toBe(true);
      expect(players.every((p) => p.last!.p.length === n - 1)).toBe(true);
      expect(metrics.snapshotsPerSecMin).toBeGreaterThanOrEqual(15); // nominal 20 Hz
      expect(stats.avgTickMs).toBeLessThan(16.7 / 2); // half the tick budget on this VM
    } finally {
      await Promise.all(players.map((p) => p.leave()));
      await waitUntil('room empty', () => ctx.app.game()!.room().playerCount === 0);
      await sleep(50);
    }
  });
});
