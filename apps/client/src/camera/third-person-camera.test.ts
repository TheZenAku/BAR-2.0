import { PerspectiveCamera } from 'three';
import { describe, expect, it } from 'vitest';
import { CAMERA, orbitDirection, resolveDistance, ThirdPersonCamera } from './third-person-camera.ts';

describe('third-person camera', () => {
  it('sits behind (+Z) at yaw 0 and above with positive pitch', () => {
    const d = orbitDirection(0, 0.3);
    expect(d.z).toBeGreaterThan(0);
    expect(d.y).toBeGreaterThan(0);
    expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1);
  });

  it('snaps in on obstruction and eases back out', () => {
    expect(resolveDistance(4, 4, 1.2, 1 / 60)).toBe(1.2);
    const next = resolveDistance(1.2, 4, 4, 1 / 60);
    expect(next).toBeGreaterThan(1.2);
    expect(next).toBeLessThan(4);
  });

  it('clamps pitch and zoom', () => {
    const cam = new ThirdPersonCamera(new PerspectiveCamera());
    cam.applyLook(0, 1e6, 1e6);
    expect(cam.pitch).toBe(CAMERA.maxPitch);
    expect(cam.desiredDistance).toBe(CAMERA.maxDistance);
    cam.applyLook(0, -1e6, -1e6);
    expect(cam.pitch).toBe(CAMERA.minPitch);
    expect(cam.desiredDistance).toBe(CAMERA.minDistance);
  });

  it('never places the camera beyond the free distance returned by the cast', () => {
    const three = new PerspectiveCamera();
    const cam = new ThirdPersonCamera(three);
    cam.update({ x: 0, y: 0, z: 0 }, 1 / 60, () => 0.8);
    const pivotY = CAMERA.pivotHeight;
    const dist = Math.hypot(three.position.x, three.position.y - pivotY, three.position.z);
    expect(dist).toBeCloseTo(0.8);
  });
});
