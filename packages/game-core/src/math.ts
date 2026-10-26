export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

export const vec3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function lerpVec3(a: Vec3, b: Vec3, t: number, out: Vec3 = vec3(0, 0, 0)): Vec3 {
  out.x = lerp(a.x, b.x, t);
  out.y = lerp(a.y, b.y, t);
  out.z = lerp(a.z, b.z, t);
  return out;
}

/** Wraps an angle to (-PI, PI]. */
export function wrapAngle(a: number): number {
  const w = a - 2 * Math.PI * Math.floor((a + Math.PI) / (2 * Math.PI));
  return w === -Math.PI ? Math.PI : w;
}

/** Interpolates along the shortest arc. */
export function lerpAngle(a: number, b: number, t: number): number {
  return wrapAngle(a + wrapAngle(b - a) * t);
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}

/** Euler angles (radians, intrinsic order XYZ — same as Three.js default) to quaternion. */
export function eulerXYZToQuat(e: Vec3): Quat {
  const c1 = Math.cos(e.x / 2);
  const c2 = Math.cos(e.y / 2);
  const c3 = Math.cos(e.z / 2);
  const s1 = Math.sin(e.x / 2);
  const s2 = Math.sin(e.y / 2);
  const s3 = Math.sin(e.z / 2);
  return {
    x: s1 * c2 * c3 + c1 * s2 * s3,
    y: c1 * s2 * c3 - s1 * c2 * s3,
    z: c1 * c2 * s3 + s1 * s2 * c3,
    w: c1 * c2 * c3 - s1 * s2 * s3,
  };
}
