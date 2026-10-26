// Integration tests against the real Rapier deterministic WASM build (no mocks).
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CHARACTER, SIM_DT } from './config.ts';
import { FixedStepper } from './fixed-step.ts';
import { GREYBOX_BAR } from './level.ts';
import type { Vec3 } from './math.ts';
import { vec3 } from './math.ts';
import type { MoveIntent } from './movement.ts';
import type { RapierApi } from './physics.ts';
import { loadRapier } from './physics.ts';
import { limitToProgress, Simulation } from './simulation.ts';

describe('limitToProgress', () => {
  it('keeps commanded direction, caps at achieved progress, never reverses', () => {
    expect(limitToProgress({ x: 2, z: 0 }, { x: 1, z: 5 })).toEqual({ x: 1, z: 0 });
    expect(limitToProgress({ x: 2, z: 0 }, { x: 9, z: 0 })).toEqual({ x: 2, z: 0 });
    expect(limitToProgress({ x: 2, z: 0 }, { x: -4, z: 0 })).toEqual({ x: 0, z: 0 });
    expect(limitToProgress({ x: 0, z: 0 }, { x: 1, z: 1 })).toEqual({ x: 0, z: 0 });
  });
});

// Camera yaw that makes "forward" point along each axis.
const TO = { posX: -Math.PI / 2, negX: Math.PI / 2, negZ: 0, posZ: Math.PI } as const;
const walk = (yaw: number, run = false): MoveIntent => ({ forward: 1, right: 0, run, yaw });
const idle: MoveIntent = { forward: 0, right: 0, run: false, yaw: 0 };

let rapier: RapierApi;
const sims: Simulation[] = [];
beforeAll(async () => {
  rapier = await loadRapier();
});
afterEach(() => {
  for (const s of sims.splice(0)) s.dispose();
});

function sim(start?: Vec3): Simulation {
  const s = new Simulation(rapier, GREYBOX_BAR);
  sims.push(s);
  if (start) s.teleport(start);
  return s;
}

function run(s: Simulation, intent: MoveIntent, seconds: number) {
  const ticks = Math.round(seconds / SIM_DT);
  let maxY = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < ticks; i++) maxY = Math.max(maxY, s.tick(intent).position.y);
  return { ...s.player, maxY };
}

describe('Simulation (Rapier deterministic)', () => {
  it('settles on the floor from a drop', () => {
    const p = run(sim(vec3(0, 1.5, 2)), idle, 1.5);
    expect(p.grounded).toBe(true);
    expect(p.position.y).toBeGreaterThanOrEqual(-0.02);
    expect(p.position.y).toBeLessThan(0.05);
  });

  it('stops at walls (collide and slide)', () => {
    const p = run(sim(vec3(8, 0, 0)), walk(TO.posX, true), 3);
    expect(p.position.x).toBeLessThanOrEqual(10 - CHARACTER.radius + 1e-3);
    expect(p.position.x).toBeGreaterThan(9.5);
    expect(p.locomotion).toBe('idle');
  });

  it('climbs the 0.18 m stairs onto the 0.54 m stage', () => {
    const p = run(sim(vec3(3.6, 0, -3.75)), walk(TO.posX), 3);
    expect(p.position.x).toBeGreaterThan(6);
    expect(p.position.y).toBeCloseTo(0.54, 1);
    expect(p.grounded).toBe(true);
  });

  it('walks up the 9.5° ramp onto the lounge', () => {
    const p = run(sim(vec3(1.5, 0, 4.5)), walk(TO.posX), 3);
    expect(p.position.x).toBeGreaterThan(6);
    expect(p.position.y).toBeCloseTo(0.5, 1);
  });

  it('cannot climb the 50° slope', () => {
    const p = run(sim(vec3(-6.5, 0, -2)), walk(TO.negX, true), 3);
    expect(p.maxY).toBeLessThan(0.6);
    expect(p.position.x).toBeGreaterThan(-8.6);
  });

  it('steps over a 0.30 m curb but is blocked by a 0.50 m block', () => {
    const curb = run(sim(vec3(-6, 0, 0.3)), walk(TO.negZ), 0.9);
    expect(curb.position.z).toBeLessThan(-1);
    expect(curb.maxY).toBeCloseTo(0.3, 1);
    const block = run(sim(vec3(-3, 0, 0.3)), walk(TO.negZ), 2);
    expect(block.position.z).toBeGreaterThan(-0.6 + CHARACTER.radius - 0.05);
    expect(block.maxY).toBeLessThan(0.1);
  });

  it('moves without stalls on flat floor once at speed', () => {
    const s = sim(vec3(-8, 0, 6));
    run(s, walk(TO.posX), 0.2);
    let prevX = s.player.position.x;
    for (let i = 0; i < 120; i++) {
      const x = s.tick(walk(TO.posX)).position.x;
      expect(x - prevX).toBeGreaterThan(0.03);
      prevX = x;
    }
  });

  it('stays grounded walking down the ramp and the stairs', () => {
    for (const [start, yaw] of [
      [vec3(7, 0.5, 4.5), TO.negX],
      [vec3(6, 0.54, -3.75), TO.negX],
    ] as const) {
      const s = sim(start);
      run(s, idle, 0.3);
      let airborne = 0;
      for (let i = 0; i < 150; i++) if (!s.tick(walk(yaw)).grounded) airborne++;
      expect(s.player.position.y).toBeLessThan(0.02);
      expect(airborne).toBeLessThanOrEqual(3);
    }
  });

  it('reports walk/run locomotion from achieved speed', () => {
    const s = sim(vec3(0, 0, 2));
    expect(run(s, walk(TO.posZ), 1).locomotion).toBe('walk');
    const s2 = sim(vec3(-8, 0, 6));
    expect(run(s2, walk(TO.posX, true), 1).locomotion).toBe('run');
  });

  it('is frame-rate independent: identical state at 30, 144 and jittery FPS', () => {
    const play = (frameTimes: () => number) => {
      const s = sim();
      const stepper = new FixedStepper(SIM_DT, 10);
      while (s.player.tick < 300) {
        stepper.advance(frameTimes(), () => {
          if (s.player.tick < 300) s.tick(s.player.tick < 200 ? walk(TO.posZ - 0.4, true) : walk(TO.negX));
        });
      }
      return s.player;
    };
    let k = 0;
    const a = play(() => 1 / 30);
    const b = play(() => 1 / 144);
    const c = play(() => [0.004, 0.031, 0.017, 0.009][k++ % 4]!);
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });

  it('is deterministic across independent worlds', () => {
    const script = (s: Simulation) => {
      for (let i = 0; i < 600; i++) s.tick({ forward: 1, right: Math.sin(i / 37), run: i % 200 < 100, yaw: i / 90 });
      return s.player;
    };
    expect(script(sim())).toEqual(script(sim()));
  });

  it('restore + replay reproduces the uninterrupted run (reconciliation)', () => {
    const intentAt = (i: number): MoveIntent => ({
      forward: 1,
      right: Math.sin(i / 23),
      run: i % 150 < 90,
      yaw: i / 70,
    });
    const authority = sim();
    const states = [];
    for (let i = 0; i < 600; i++) {
      authority.tick(intentAt(i));
      states.push(authority.state());
    }
    // The predictor rewinds 6 ticks every 20 and replays them, as the client does on every snapshot.
    const predictor = sim();
    for (let i = 0; i < 600; i++) {
      predictor.tick(intentAt(i));
      if (i % 20 === 19) {
        predictor.restore(states[i - 6]!, i - 5);
        for (let j = i - 5; j <= i; j++) predictor.tick(intentAt(j));
      }
    }
    expect(predictor.player).toEqual(authority.player);
    expect(predictor.state()).toEqual(authority.state());
  });

  it('frees physics resources on dispose and tolerates double dispose', () => {
    const s = new Simulation(rapier, GREYBOX_BAR);
    s.dispose();
    expect(s.physics.isDisposed).toBe(true);
    expect(() => s.dispose()).not.toThrow();
  });
});

describe('GREYBOX_BAR spawn points', () => {
  it('are all on open floor: the character settles there without being pushed', () => {
    const points = GREYBOX_BAR.spawnPoints ?? [];
    expect(points.length).toBeGreaterThanOrEqual(8);
    for (const p of points) {
      const s = sim(p);
      const end = run(s, idle, 0.5);
      expect(end.grounded, JSON.stringify(p)).toBe(true);
      expect(Math.hypot(end.position.x - p.x, end.position.z - p.z), JSON.stringify(p)).toBeLessThan(0.01);
      expect(Math.abs(end.position.y - p.y), JSON.stringify(p)).toBeLessThan(0.02);
    }
  });
});
