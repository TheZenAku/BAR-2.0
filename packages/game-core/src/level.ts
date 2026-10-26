import type { Vec3 } from './math.ts';
import { vec3 } from './math.ts';

/** Visual category only; renderers map it to a material. Physics treats every box the same. */
export type Surface = 'floor' | 'wall' | 'wood' | 'stage' | 'prop';

/** Oriented box. Rotation is Euler XYZ in radians (Three.js default order). */
export interface BoxDef {
  readonly id: string;
  readonly center: Vec3;
  readonly half: Vec3;
  readonly rotation?: Vec3;
  readonly surface: Surface;
}

export interface LevelDef {
  readonly name: string;
  readonly spawn: Vec3;
  /** Initial camera yaw at spawn. */
  readonly spawnYaw: number;
  readonly boxes: readonly BoxDef[];
}

/** Axis-aligned box from min/max corners. */
export function aabb(id: string, min: Vec3, max: Vec3, surface: Surface): BoxDef {
  return {
    id,
    surface,
    center: vec3((min.x + max.x) / 2, (min.y + max.y) / 2, (min.z + max.z) / 2),
    half: vec3((max.x - min.x) / 2, (max.y - min.y) / 2, (max.z - min.z) / 2),
  };
}

/** Slab whose top surface runs from `a` to `b` along X (tilted about Z), `width` deep in Z. */
export function rampX(id: string, a: Vec3, b: Vec3, width: number, surface: Surface, thickness = 0.1): BoxDef {
  const [lo, hi] = a.x <= b.x ? [a, b] : [b, a];
  const dx = hi.x - lo.x;
  const dy = hi.y - lo.y;
  const angle = Math.atan2(dy, dx);
  const t = thickness / 2;
  return {
    id,
    surface,
    center: vec3((lo.x + hi.x) / 2 + Math.sin(angle) * t, (lo.y + hi.y) / 2 - Math.cos(angle) * t, (lo.z + hi.z) / 2),
    half: vec3(Math.hypot(dx, dy) / 2, t, width / 2),
    rotation: vec3(0, 0, angle),
  };
}

const H = 3; // wall height

/**
 * Provisional greybox of the bar (20 × 14 m). Not art: it exists to exercise movement, stairs, slopes,
 * step limits and camera collision. Replaced by colliders derived from the real GLB in M6.
 */
export const GREYBOX_BAR: LevelDef = {
  name: 'greybox-bar',
  spawn: vec3(0, 0, 2),
  spawnYaw: 0,
  boxes: [
    aabb('floor', vec3(-10, -0.2, -7), vec3(10, 0, 7), 'floor'),
    aabb('wall-n', vec3(-10.2, 0, -7.2), vec3(10.2, H, -7), 'wall'),
    aabb('wall-s', vec3(-10.2, 0, 7), vec3(10.2, H, 7.2), 'wall'),
    aabb('wall-w', vec3(-10.2, 0, -7), vec3(-10, H, 7), 'wall'),
    aabb('wall-e', vec3(10, 0, -7), vec3(10.2, H, 7), 'wall'),
    // Bar counter and back shelf.
    aabb('counter', vec3(-4, 0, -5.05), vec3(2, 1.1, -4.15), 'wood'),
    aabb('shelf', vec3(-4, 0, -7), vec3(2, 2, -6.5), 'wood'),
    // Stage (0.54 m) reached by two 0.18 m steps.
    aabb('stage', vec3(5, 0, -7), vec3(10, 0.54, -2.5), 'stage'),
    aabb('stage-step-1', vec3(4.4, 0, -4.5), vec3(5, 0.18, -3), 'stage'),
    aabb('stage-step-2', vec3(4.7, 0, -4.5), vec3(5, 0.36, -3), 'stage'),
    // Raised lounge (0.5 m) reached by a 9.5° ramp.
    aabb('lounge', vec3(5.5, 0, 2.5), vec3(10, 0.5, 7), 'stage'),
    rampX('lounge-ramp', vec3(2.5, 0, 4.5), vec3(5.5, 0.5, 4.5), 2, 'floor'),
    // Steep 50° slope: must not be climbable.
    rampX('steep-slope', vec3(-7.9, 0, -2), vec3(-9.9, 2.4, -2), 1.6, 'prop'),
    // Step-limit probes: 0.30 m curb (climbable) and 0.50 m block (not climbable).
    aabb('curb', vec3(-7, 0, -1.4), vec3(-5, 0.3, -0.6), 'prop'),
    aabb('block', vec3(-3.6, 0, -1.4), vec3(-2.4, 0.5, -0.6), 'prop'),
    aabb('pillar-w', vec3(-2.75, 0, 0.25), vec3(-2.25, H, 0.75), 'wall'),
    aabb('pillar-e', vec3(2.25, 0, 0.25), vec3(2.75, H, 0.75), 'wall'),
    aabb('table-1', vec3(-7, 0, 3.5), vec3(-6.1, 0.75, 4.4), 'wood'),
    aabb('table-2', vec3(-4, 0, 4.6), vec3(-3.1, 0.75, 5.5), 'wood'),
    aabb('table-3', vec3(-1, 0, 5.2), vec3(-0.1, 0.75, 6.1), 'wood'),
  ],
};
