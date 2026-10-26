import type RAPIER from '@dimforge/rapier3d-deterministic-compat';
import { BODY_CENTER_Y, CHARACTER } from './config.ts';
import type { Vec3 } from './math.ts';
import { vec3 } from './math.ts';
import type { Planar } from './movement.ts';
import type { PhysicsWorld } from './physics.ts';

export interface MotorResult {
  /** Feet position. */
  readonly position: Vec3;
  /** Velocity actually achieved after collisions (m/s). */
  readonly velocity: Vec3;
  readonly grounded: boolean;
}

/**
 * Kinematic body driven by Rapier's character controller: collide-and-slide, auto-step for stairs/curbs,
 * slope limits and snap-to-ground. Gravity is integrated here, not by the physics world.
 */
export class CharacterMotor {
  private readonly body: RAPIER.RigidBody;
  private readonly collider: RAPIER.Collider;
  private readonly controller: RAPIER.KinematicCharacterController;
  private readonly physics: PhysicsWorld;
  private readonly spawn: Vec3;
  private verticalSpeed = 0;
  private result: MotorResult;

  constructor(physics: PhysicsWorld, spawn: Vec3) {
    this.physics = physics;
    this.spawn = { ...spawn };
    const { rapier, world } = physics;
    this.body = world.createRigidBody(
      rapier.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn.x, spawn.y + BODY_CENTER_Y, spawn.z),
    );
    this.collider = world.createCollider(
      rapier.ColliderDesc.roundCylinder(
        CHARACTER.halfHeight - CHARACTER.borderRadius,
        CHARACTER.radius - CHARACTER.borderRadius,
        CHARACTER.borderRadius,
      ),
      this.body,
    );
    this.controller = world.createCharacterController(CHARACTER.skin);
    this.controller.enableAutostep(CHARACTER.maxStepHeight, CHARACTER.minStepWidth, false);
    this.controller.enableSnapToGround(CHARACTER.snapToGround);
    this.controller.setMaxSlopeClimbAngle(CHARACTER.maxSlopeClimb);
    this.controller.setMinSlopeSlideAngle(CHARACTER.minSlopeSlide);
    this.controller.setSlideEnabled(true);
    this.controller.setApplyImpulsesToDynamicBodies(false);
    this.result = { position: { ...spawn }, velocity: vec3(0, 0, 0), grounded: false };
  }

  get state(): MotorResult {
    return this.result;
  }

  /** Moves for one tick. The physics world must be stepped afterwards to commit the kinematic pose. */
  move(planar: Planar, dt: number): MotorResult {
    // Grounded: no downward push — snap-to-ground keeps contact on slopes and steps down. A constant push into
    // the floor made the controller report zero progress every few ticks (measured stalls in M1).
    this.verticalSpeed = this.result.grounded
      ? 0
      : Math.max(this.verticalSpeed + CHARACTER.gravity * dt, CHARACTER.terminalFallSpeed);
    this.controller.computeColliderMovement(this.collider, {
      x: planar.x * dt,
      y: this.verticalSpeed * dt,
      z: planar.z * dt,
    });
    const m = this.controller.computedMovement();
    const grounded = this.controller.computedGrounded();
    const t = this.body.translation();
    const next = { x: t.x + m.x, y: t.y + m.y, z: t.z + m.z };
    if (next.y < CHARACTER.killPlaneY) return this.teleport(this.spawn);
    this.body.setNextKinematicTranslation(next);
    if (grounded) this.verticalSpeed = 0;
    this.result = {
      position: vec3(next.x, next.y - BODY_CENTER_Y, next.z),
      velocity: vec3(m.x / dt, m.y / dt, m.z / dt),
      grounded,
    };
    return this.result;
  }

  teleport(feet: Vec3): MotorResult {
    const center = { x: feet.x, y: feet.y + BODY_CENTER_Y, z: feet.z };
    this.body.setTranslation(center, true);
    this.body.setNextKinematicTranslation(center);
    this.verticalSpeed = 0;
    this.result = { position: { ...feet }, velocity: vec3(0, 0, 0), grounded: false };
    return this.result;
  }

  dispose(): void {
    if (this.physics.isDisposed) return;
    const { world } = this.physics;
    world.removeCharacterController(this.controller);
    world.removeRigidBody(this.body); // also removes the attached collider
  }
}
