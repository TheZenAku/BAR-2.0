import type { Locomotion, Vec3 } from '@bar/game-core';
import type { Object3D } from 'three';

/**
 * Rendering contract for a character. The game loop only talks to this interface, so the technical
 * avatar can be swapped for the rigged GLB avatar (M5) without touching input, camera or simulation.
 * Model convention: feet at origin, facing +Z.
 */
export interface AvatarView {
  readonly object: Object3D;
  setPose(feet: Vec3, yaw: number): void;
  setLocomotion(state: Locomotion, speed: number): void;
  /** Advances animation by real (render) time. */
  update(dt: number): void;
  readonly activeAnimation: Locomotion;
  dispose(): void;
}
