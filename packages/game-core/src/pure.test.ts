import { describe, expect, it } from 'vitest';
import { MOVEMENT, SIM_DT } from './config.ts';
import { FixedStepper } from './fixed-step.ts';
import { GREYBOX_BAR, rampX } from './level.ts';
import { nextLocomotion } from './locomotion.ts';
import { eulerXYZToQuat, lerpAngle, vec3, wrapAngle } from './math.ts';
import { approachVelocity, sanitizeIntent, targetVelocity, turnTowards } from './movement.ts';

describe('FixedStepper', () => {
  it('runs the same number of ticks regardless of frame rate', () => {
    const count = (frameDt: number, frames: number) => {
      const s = new FixedStepper(1 / 60);
      let n = 0;
      for (let i = 0; i < frames; i++) s.advance(frameDt, () => n++);
      return n;
    };
    expect(count(1 / 30, 60)).toBe(120);
    expect(count(1 / 120, 240)).toBe(120);
    expect(count(1 / 240, 480)).toBe(120);
  });

  it('returns interpolation alpha in [0,1) and clamps long stalls', () => {
    const s = new FixedStepper(0.1, 3);
    let n = 0;
    expect(s.advance(0.05, () => n++)).toBeCloseTo(0.5);
    expect(n).toBe(0);
    s.advance(10, () => n++);
    expect(n).toBe(3);
    expect(s.droppedTicks).toBeGreaterThan(90);
    const a = s.advance(0, () => n++);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(1);
  });

  it('ignores non-finite and negative frame times', () => {
    const s = new FixedStepper(0.1);
    let n = 0;
    s.advance(Number.NaN, () => n++);
    s.advance(-5, () => n++);
    s.advance(Number.POSITIVE_INFINITY, () => n++);
    expect(n).toBe(0);
  });
});

describe('movement', () => {
  it('maps forward to -Z at camera yaw 0 and to +X at yaw -PI/2', () => {
    const v0 = targetVelocity({ forward: 1, right: 0, run: false, yaw: 0 });
    expect(v0.x).toBeCloseTo(0);
    expect(v0.z).toBeCloseTo(-MOVEMENT.walkSpeed);
    const v1 = targetVelocity({ forward: 1, right: 0, run: true, yaw: -Math.PI / 2 });
    expect(v1.x).toBeCloseTo(MOVEMENT.runSpeed);
    const right = targetVelocity({ forward: 0, right: 1, run: false, yaw: 0 });
    expect(right.x).toBeCloseTo(MOVEMENT.walkSpeed);
  });

  it('does not move faster diagonally', () => {
    const v = targetVelocity({ forward: 1, right: 1, run: false, yaw: 0.3 });
    expect(Math.hypot(v.x, v.z)).toBeCloseTo(MOVEMENT.walkSpeed);
  });

  it('sanitizes out-of-range and non-finite intents', () => {
    expect(sanitizeIntent({ forward: 50, right: Number.NaN, run: 1 as unknown as boolean, yaw: Infinity })).toEqual({
      forward: 1,
      right: 0,
      run: false,
      yaw: 0,
    });
  });

  it('accelerates and decelerates at bounded rates', () => {
    let v = { x: 0, z: 0 };
    v = approachVelocity(v, { x: 5, z: 0 }, SIM_DT);
    expect(v.x).toBeCloseTo(MOVEMENT.acceleration * SIM_DT);
    for (let i = 0; i < 60; i++) v = approachVelocity(v, { x: 5, z: 0 }, SIM_DT);
    expect(v.x).toBe(5);
    v = approachVelocity(v, { x: 0, z: 0 }, SIM_DT);
    expect(v.x).toBeCloseTo(5 - MOVEMENT.deceleration * SIM_DT);
  });

  it('turns along the shortest arc', () => {
    expect(turnTowards(3, -3, 0.1)).toBeCloseTo(3.1);
    expect(turnTowards(0, 0.05, 0.1)).toBeCloseTo(0.05);
  });
});

describe('locomotion', () => {
  it('uses hysteresis between idle, walk and run', () => {
    expect(nextLocomotion('idle', 0.2)).toBe('idle');
    expect(nextLocomotion('idle', 0.3)).toBe('walk');
    expect(nextLocomotion('walk', 0.15)).toBe('walk');
    expect(nextLocomotion('walk', 0.05)).toBe('idle');
    expect(nextLocomotion('walk', MOVEMENT.walkSpeed)).toBe('walk');
    expect(nextLocomotion('walk', MOVEMENT.runSpeed)).toBe('run');
    expect(nextLocomotion('run', 3.6)).toBe('run');
    expect(nextLocomotion('run', MOVEMENT.walkSpeed)).toBe('walk');
    expect(nextLocomotion('idle', MOVEMENT.runSpeed)).toBe('run');
  });
});

describe('math', () => {
  it('wraps and interpolates angles across the seam', () => {
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI);
    expect(wrapAngle(-Math.PI)).toBeCloseTo(Math.PI);
    expect(Math.abs(lerpAngle(3, -3, 0.5))).toBeCloseTo(Math.PI, 1);
  });

  it('converts Euler XYZ to a unit quaternion matching a Z rotation', () => {
    const q = eulerXYZToQuat(vec3(0, 0, Math.PI / 2));
    expect(q.z).toBeCloseTo(Math.SQRT1_2);
    expect(q.w).toBeCloseTo(Math.SQRT1_2);
    expect(Math.hypot(q.x, q.y, q.z, q.w)).toBeCloseTo(1);
  });
});

describe('level', () => {
  it('rampX puts the top surface on the requested endpoints', () => {
    const r = rampX('r', vec3(0, 0, 0), vec3(3, 0.5, 0), 2, 'floor');
    const angle = r.rotation!.z;
    // Top-surface point at the +X end in world space.
    const tx = r.center.x + Math.cos(angle) * r.half.x - Math.sin(angle) * r.half.y;
    const ty = r.center.y + Math.sin(angle) * r.half.x + Math.cos(angle) * r.half.y;
    expect(tx).toBeCloseTo(3);
    expect(ty).toBeCloseTo(0.5);
  });

  it('greybox has unique ids and positive extents', () => {
    const ids = new Set(GREYBOX_BAR.boxes.map((b) => b.id));
    expect(ids.size).toBe(GREYBOX_BAR.boxes.length);
    for (const b of GREYBOX_BAR.boxes) expect(Math.min(b.half.x, b.half.y, b.half.z)).toBeGreaterThan(0);
  });
});
