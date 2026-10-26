import { CharacterMotor } from './character.ts';
import { MOVEMENT, SIM_DT } from './config.ts';
import type { LevelDef } from './level.ts';
import type { Locomotion } from './locomotion.ts';
import { nextLocomotion } from './locomotion.ts';
import type { Vec3 } from './math.ts';
import { clamp } from './math.ts';
import type { MoveIntent, Planar } from './movement.ts';
import { approachVelocity, sanitizeIntent, targetVelocity, turnTowards, yawOf } from './movement.ts';
import type { RapierApi } from './physics.ts';
import { PhysicsWorld } from './physics.ts';

export interface PlayerSnapshot {
  readonly tick: number;
  /** Feet position. */
  readonly position: Vec3;
  /** Body facing (radians, +Z-facing model). */
  readonly yaw: number;
  /** Achieved horizontal speed (m/s). */
  readonly speed: number;
  readonly grounded: boolean;
  readonly locomotion: Locomotion;
}

/**
 * Scales the commanded velocity down to the progress actually made along it, so pushing into a wall does not
 * build up hidden speed. It never adds speed or reverses direction: the controller's depenetration and
 * auto-step corrections can momentarily move the body backwards, and feeding that back would become momentum.
 */
export function limitToProgress(commanded: Planar, achieved: Planar): Planar {
  const len2 = commanded.x * commanded.x + commanded.z * commanded.z;
  if (len2 === 0) return { x: 0, z: 0 };
  const k = clamp((achieved.x * commanded.x + achieved.z * commanded.z) / len2, 0, 1);
  return { x: commanded.x * k, z: commanded.z * k };
}

/**
 * Single-player simulation for the vertical slice: one physics world, one controlled character, fixed ticks.
 * Free of DOM and rendering so the server can run the same code (M3).
 */
export class Simulation {
  readonly level: LevelDef;
  readonly physics: PhysicsWorld;
  private readonly motor: CharacterMotor;
  private velocity: Planar = { x: 0, z: 0 };
  private current: PlayerSnapshot;

  constructor(rapier: RapierApi, level: LevelDef) {
    this.level = level;
    this.physics = new PhysicsWorld(rapier, level);
    this.motor = new CharacterMotor(this.physics, level.spawn);
    this.current = {
      tick: 0,
      position: { ...level.spawn },
      // Face away from the camera (camera at yaw 0 looks toward -Z; the model faces +Z at yaw 0).
      yaw: level.spawnYaw + Math.PI,
      speed: 0,
      grounded: false,
      locomotion: 'idle',
    };
  }

  get player(): PlayerSnapshot {
    return this.current;
  }

  tick(rawIntent: MoveIntent): PlayerSnapshot {
    const intent = sanitizeIntent(rawIntent);
    this.velocity = approachVelocity(this.velocity, targetVelocity(intent), SIM_DT);
    const r = this.motor.move(this.velocity, SIM_DT);
    this.physics.step();
    this.velocity = limitToProgress(this.velocity, r.velocity);
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    const prev = this.current;
    const yaw = speed > 0.1 ? turnTowards(prev.yaw, yawOf(r.velocity), MOVEMENT.turnRate * SIM_DT) : prev.yaw;
    this.current = {
      tick: prev.tick + 1,
      position: r.position,
      yaw,
      speed,
      grounded: r.grounded,
      locomotion: nextLocomotion(prev.locomotion, speed),
    };
    return this.current;
  }

  teleport(feet: Vec3): void {
    this.motor.teleport(feet);
    this.velocity = { x: 0, z: 0 };
    this.current = { ...this.current, position: { ...feet }, speed: 0, locomotion: 'idle' };
  }

  dispose(): void {
    this.motor.dispose();
    this.physics.dispose();
  }
}
