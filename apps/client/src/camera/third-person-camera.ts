// Orbit camera behind the character. Owns yaw/pitch/zoom; collision is delegated to a cast function so the
// camera does not depend on the physics implementation.
import type { Vec3 } from '@bar/game-core';
import { clamp, wrapAngle } from '@bar/game-core';
import type { PerspectiveCamera } from 'three';

/** Returns free distance from `origin` along unit `dir` up to `max`. */
export type CastFn = (origin: Vec3, dir: Vec3, radius: number, max: number) => number;

export const CAMERA = {
  pivotHeight: 1.55,
  sensitivity: 0.0025,
  minPitch: -0.35,
  maxPitch: 1.2,
  minDistance: 1.4,
  maxDistance: 7,
  zoomStep: 0.5,
  probeRadius: 0.2,
  /** Rate (1/s) at which the camera eases back out after an obstruction clears. */
  recoverRate: 6,
  /** Rate (1/s) at which the pivot follows the character (smooths step-ups). */
  followRate: 18,
} as const;

/** Unit vector from pivot to camera for the given orbit angles (yaw 0 = camera on +Z looking toward -Z). */
export function orbitDirection(yaw: number, pitch: number): Vec3 {
  const c = Math.cos(pitch);
  return { x: Math.sin(yaw) * c, y: Math.sin(pitch), z: Math.cos(yaw) * c };
}

/** Obstructions pull the camera in instantly (never clip through walls); clearing eases back out. */
export function resolveDistance(current: number, desired: number, free: number, dt: number): number {
  const target = Math.min(desired, free);
  if (target <= current) return target;
  return current + (target - current) * (1 - Math.exp(-CAMERA.recoverRate * dt));
}

const damp = (a: number, b: number, rate: number, dt: number) => a + (b - a) * (1 - Math.exp(-rate * dt));

export class ThirdPersonCamera {
  yaw: number;
  pitch = 0.3;
  desiredDistance = 4;
  distance = 4;
  private readonly pivot: Vec3 = { x: 0, y: 0, z: 0 };
  private initialized = false;
  private readonly camera: PerspectiveCamera;

  constructor(camera: PerspectiveCamera, yaw = 0) {
    this.camera = camera;
    this.yaw = yaw;
  }

  applyLook(dx: number, dy: number, zoom: number): void {
    this.yaw = wrapAngle(this.yaw - dx * CAMERA.sensitivity);
    this.pitch = clamp(this.pitch + dy * CAMERA.sensitivity, CAMERA.minPitch, CAMERA.maxPitch);
    this.desiredDistance = clamp(this.desiredDistance + zoom * CAMERA.zoomStep, CAMERA.minDistance, CAMERA.maxDistance);
  }

  /** `feet` is the interpolated character position for this frame. */
  update(feet: Vec3, dt: number, cast: CastFn): void {
    const tx = feet.x;
    const ty = feet.y + CAMERA.pivotHeight;
    const tz = feet.z;
    if (!this.initialized) {
      Object.assign(this.pivot, { x: tx, y: ty, z: tz });
      this.initialized = true;
    }
    // Horizontal follow is exact (no lag while running); vertical is damped so steps don't jolt the view.
    this.pivot.x = tx;
    this.pivot.z = tz;
    this.pivot.y = damp(this.pivot.y, ty, CAMERA.followRate, dt);
    const dir = orbitDirection(this.yaw, this.pitch);
    const free = cast(this.pivot, dir, CAMERA.probeRadius, this.desiredDistance);
    this.distance = resolveDistance(this.distance, this.desiredDistance, free, dt);
    const p = this.pivot;
    this.camera.position.set(p.x + dir.x * this.distance, p.y + dir.y * this.distance, p.z + dir.z * this.distance);
    this.camera.lookAt(p.x, p.y, p.z);
  }
}
