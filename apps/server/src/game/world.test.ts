// Authoritative world without networking, against the real Rapier build: input timing, time budget, spawns.
import { GREYBOX_BAR, loadRapier, type RapierApi, Simulation } from '@bar/game-core';
import type { InputFrame } from '@bar/shared';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { BUDGET_MAX_TICKS, GameWorld, INPUT_BACKLOG_MAX } from './world.ts';

let rapier: RapierApi;
const worlds: GameWorld[] = [];
beforeAll(async () => {
  rapier = await loadRapier();
});
afterEach(() => {
  for (const w of worlds.splice(0)) w.dispose();
});
const world = () => {
  const w = new GameWorld(rapier, GREYBOX_BAR);
  worlds.push(w);
  return w;
};
const id = (n: number) => ({ userId: `u${n}`, publicId: `p${n}`, displayName: `P${n}` });
const frame = (seq: number): InputFrame => [seq, 1, Math.sin(seq / 9), seq % 80 < 40, seq / 60];

describe('GameWorld', () => {
  it('replays exactly the client input sequence despite jittery arrival (no divergence to correct)', () => {
    const w = world();
    const p = w.add(id(1));
    const client = new Simulation(rapier, GREYBOX_BAR);
    client.restore(p.sim.state(), p.sim.player.tick);
    let seq = 0;
    // Arrivals: pairs, gaps, a burst of 7 after a hitch.
    for (const batch of [2, 0, 2, 0, 1, 3, 0, 0, 0, 7, 2, 0, 2, 2, 0, 2]) {
      const frames = Array.from({ length: batch }, () => frame(seq++));
      for (const [, forward, right, run, yaw] of frames) client.tick({ forward, right, run, yaw });
      if (frames.length) p.enqueue(frames);
      w.step();
    }
    for (let i = 0; i < 10; i++) w.step(); // drain
    expect(p.ackSeq).toBe(seq - 1);
    expect(p.sim.state()).toEqual(client.state());
    client.dispose();
  });

  it('never applies more inputs than real time allows (flood = speed hack)', () => {
    const w = world();
    const p = w.add(id(1));
    let seq = 0;
    for (let tick = 0; tick < 120; tick++) {
      p.enqueue(Array.from({ length: 8 }, () => frame(seq++)));
      w.step();
    }
    // 120 ticks of time + the jitter allowance, however many inputs were sent.
    expect(p.counters.applied).toBeLessThanOrEqual(120 + BUDGET_MAX_TICKS);
    expect(p.counters.dropped).toBeGreaterThan(0);
  });

  it('stops a silent player after the jitter allowance, without granting extra budget', () => {
    const w = world();
    const p = w.add(id(1));
    let seq = 0;
    for (let i = 0; i < 30; i++) {
      p.enqueue([frame(seq++)]);
      w.step();
    }
    expect(p.sim.player.speed).toBeGreaterThan(1);
    for (let i = 0; i < BUDGET_MAX_TICKS; i++) w.step();
    expect(p.counters.idleSteps).toBe(0);
    for (let i = 0; i < 60; i++) w.step();
    expect(p.counters.idleSteps).toBe(60);
    expect(p.sim.player.speed).toBe(0);
  });

  it('ignores duplicates and keeps only the newest backlog', () => {
    const w = world();
    const p = w.add(id(1));
    const frames = Array.from({ length: INPUT_BACKLOG_MAX + 5 }, (_, i) => frame(i));
    p.enqueue(frames);
    p.enqueue(frames.slice(0, 3));
    expect(p.counters.duplicates).toBe(3);
    expect(p.counters.dropped).toBe(5);
  });

  it('spawns players on distinct spots and frees their physics on removal', () => {
    const w = world();
    const players = [1, 2, 3, 4].map((n) => w.add(id(n)));
    const spots = new Set(players.map((p) => `${p.sim.player.position.x},${p.sim.player.position.z}`));
    expect(spots.size).toBe(4);
    expect(w.remove(players[0]!.pid)).toBe(true);
    expect(players[0]!.sim.physics.isDisposed).toBe(true);
    expect(w.roster().map((r) => r.pid)).toEqual(players.slice(1).map((p) => p.pid));
  });
});
