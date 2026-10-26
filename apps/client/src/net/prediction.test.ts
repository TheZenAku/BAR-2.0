// Prediction/reconciliation against the real game-core simulation: the server is played by a second Simulation.
import { GREYBOX_BAR, loadRapier, type MoveIntent, type RapierApi, Simulation } from '@bar/game-core';
import { LOCOMOTION_CODES, type SelfState } from '@bar/shared';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Predictor, selfToState } from './prediction.ts';

let rapier: RapierApi;
const sims: Simulation[] = [];
beforeAll(async () => {
  rapier = await loadRapier();
});
afterEach(() => {
  for (const s of sims.splice(0)) s.dispose();
});
const sim = () => {
  const s = new Simulation(rapier, GREYBOX_BAR);
  sims.push(s);
  return s;
};

const toSelf = (s: Simulation): SelfState => {
  const st = s.state();
  return [
    st.position.x,
    st.position.y,
    st.position.z,
    st.yaw,
    st.velocity.x,
    st.velocity.z,
    st.verticalSpeed,
    st.grounded ? 1 : 0,
    LOCOMOTION_CODES.indexOf(st.locomotion),
  ];
};
const intentAt = (i: number): MoveIntent => ({ forward: 1, right: Math.sin(i / 17), run: i % 90 < 50, yaw: i / 50 });

describe('Predictor', () => {
  it('stays exactly on the server trajectory when both apply the same inputs (no corrections)', () => {
    const server = sim();
    const predictor = new Predictor(sim());
    const wire: { forward: number; right: number; run: boolean; yaw: number }[] = [];
    for (let i = 0; i < 400; i++) {
      const [, forward, right, run, yaw] = predictor.tick(intentAt(i));
      wire.push({ forward, right, run, yaw });
      // The server applies each frame 5 ticks later (latency) and snapshots every 3 ticks.
      if (i >= 5) server.tick(wire[i - 5]!);
      if (i >= 5 && i % 3 === 0) predictor.reconcile(i - 5, toSelf(server));
    }
    expect(predictor.corrections).toBe(0);
    expect(predictor.pendingCount).toBe(5); // the last snapshot (i = 399) acked 394
  });

  it('corrects to the authority and replays pending inputs after a server-side divergence', () => {
    const local = sim();
    const predictor = new Predictor(local);
    for (let i = 0; i < 30; i++) predictor.tick({ forward: 1, right: 0, run: false, yaw: 0 });
    // The server says the player is elsewhere at seq 19 (e.g. it repeated inputs during a stall).
    const server = sim();
    server.teleport({ x: 1, y: 0, z: 2 });
    for (let i = 0; i < 20; i++) server.tick({ forward: 1, right: 0, run: false, yaw: 0 });
    const jump = predictor.reconcile(19, toSelf(server));
    expect(Math.hypot(jump.x, jump.z)).toBeGreaterThan(0.5);
    expect(predictor.corrections).toBe(1);
    expect(predictor.pendingCount).toBe(10);
    // Equivalent to the server state advanced by the 10 unacknowledged inputs.
    for (let i = 0; i < 10; i++) server.tick({ forward: 1, right: 0, run: false, yaw: 0 });
    expect(local.player.position).toEqual(server.player.position);
  });

  it('sends sanitized frames (wrapped yaw, clamped axes)', () => {
    const predictor = new Predictor(sim());
    const [seq, forward, right, run, yaw] = predictor.tick({ forward: 3, right: -Infinity, run: true, yaw: 40 });
    expect([seq, forward, right, run]).toEqual([0, 1, 0, true]);
    expect(Math.abs(yaw)).toBeLessThanOrEqual(Math.PI);
  });

  it('maps wire state back to a full character state', () => {
    expect(selfToState([1, 2, 3, 0.5, 0.1, -0.2, -1, 0, 2])).toEqual({
      position: { x: 1, y: 2, z: 3 },
      yaw: 0.5,
      velocity: { x: 0.1, z: -0.2 },
      verticalSpeed: -1,
      grounded: false,
      locomotion: 'run',
    });
  });
});
