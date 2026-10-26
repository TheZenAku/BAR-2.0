import { MOVEMENT } from './config.ts';
import { clamp, wrapAngle } from './math.ts';

/** Player intention for one tick. This is what the client will send to the server (M3), never a position. */
export interface MoveIntent {
  /** -1 (back) .. 1 (forward). */
  forward: number;
  /** -1 (left) .. 1 (right). */
  right: number;
  run: boolean;
  /** Camera yaw that defines "forward" (radians). */
  yaw: number;
}

export interface Planar {
  x: number;
  z: number;
}

export const IDLE_INTENT: Readonly<MoveIntent> = { forward: 0, right: 0, run: false, yaw: 0 };

const axis = (v: number) => (Number.isFinite(v) ? clamp(v, -1, 1) : 0);

/** Clamps every field to its legal range; non-finite values become neutral. */
export function sanitizeIntent(i: MoveIntent): MoveIntent {
  return {
    forward: axis(i.forward),
    right: axis(i.right),
    run: i.run === true,
    yaw: Number.isFinite(i.yaw) ? wrapAngle(i.yaw) : 0,
  };
}

/** World-space target velocity for an intent. Camera at yaw 0 looks toward -Z. Diagonals are not faster. */
export function targetVelocity(intent: MoveIntent): Planar {
  let f = intent.forward;
  let r = intent.right;
  const len = Math.hypot(f, r);
  if (len < 1e-6) return { x: 0, z: 0 };
  if (len > 1) {
    f /= len;
    r /= len;
  }
  const speed = intent.run ? MOVEMENT.runSpeed : MOVEMENT.walkSpeed;
  const s = Math.sin(intent.yaw);
  const c = Math.cos(intent.yaw);
  return { x: (-s * f + c * r) * speed, z: (-c * f - s * r) * speed };
}

/** Moves `current` toward `target` limited by acceleration (or deceleration when stopping). */
export function approachVelocity(current: Planar, target: Planar, dt: number): Planar {
  const stopping = target.x === 0 && target.z === 0;
  const maxDelta = (stopping ? MOVEMENT.deceleration : MOVEMENT.acceleration) * dt;
  const dx = target.x - current.x;
  const dz = target.z - current.z;
  const d = Math.hypot(dx, dz);
  if (d <= maxDelta) return { x: target.x, z: target.z };
  return { x: current.x + (dx / d) * maxDelta, z: current.z + (dz / d) * maxDelta };
}

/** Rotates `current` toward `target` by at most `maxDelta`, along the shortest arc. */
export function turnTowards(current: number, target: number, maxDelta: number): number {
  const diff = wrapAngle(target - current);
  if (Math.abs(diff) <= maxDelta) return wrapAngle(target);
  return wrapAngle(current + Math.sign(diff) * maxDelta);
}

/** Yaw that makes a +Z-facing model look along the velocity. */
export function yawOf(v: Planar): number {
  return Math.atan2(v.x, v.z);
}
