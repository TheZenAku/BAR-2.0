// Engine-independent simulation: Rapier world, kinematic character controllers,
// deterministic bot wandering and a collision-aware third-person camera.
import RAPIER from '@dimforge/rapier3d-compat';
import type { AvatarState, CameraState, ColliderFile, Vec3 } from './types';

const CAPSULE_HALF = 0.55;
const CAPSULE_RADIUS = 0.3;
const CENTER_Y = CAPSULE_HALF + CAPSULE_RADIUS;
const PLAYER_SPEED = 3.0;
const BOT_SPEED = 1.4;
const GRAVITY = -9.81;

export interface MoveInput {
  forward: number; // -1..1
  right: number; // -1..1
}

interface Character {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  state: AvatarState;
  vy: number;
  grounded: boolean;
  target: [number, number];
  stuckTime: number;
}

function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Simulation {
  readonly avatars: AvatarState[] = [];
  readonly camera: CameraState = { position: [0, 3, 8], target: [0, 1.5, 0] };
  camYaw = 0;
  camPitch = 0.35;
  camDistance = 4;

  private world!: RAPIER.World;
  private controller!: RAPIER.KinematicCharacterController;
  private chars: Character[] = [];
  private rng = mulberry32(1234);
  private walkable!: ColliderFile['walkable'];

  static async create(colliders: ColliderFile, count: number): Promise<Simulation> {
    await RAPIER.init();
    const sim = new Simulation();
    sim.setup(colliders, count);
    return sim;
  }

  private setup(file: ColliderFile, count: number): void {
    this.walkable = file.walkable;
    this.world = new RAPIER.World({ x: 0, y: GRAVITY, z: 0 });
    for (const c of file.colliders) {
      const h = c.max.map((v, k) => (v - c.min[k]!) / 2);
      const ctr = c.max.map((v, k) => (v + c.min[k]!) / 2);
      this.world.createCollider(RAPIER.ColliderDesc.cuboid(h[0]!, h[1]!, h[2]!).setTranslation(ctr[0]!, ctr[1]!, ctr[2]!));
    }
    for (let i = 0; i < count; i++) {
      const p: Vec3 = i === 0 ? [...file.spawn] : this.randomPoint();
      const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(p[0], p[1] + CENTER_Y, p[2]));
      const collider = this.world.createCollider(RAPIER.ColliderDesc.capsule(CAPSULE_HALF, CAPSULE_RADIUS), body);
      const state: AvatarState = { position: p, yaw: i === 0 ? Math.PI : this.rng() * Math.PI * 2, anim: 'Idle' };
      const t = this.randomXZ();
      this.chars.push({ body, collider, state, vy: 0, grounded: false, target: t, stuckTime: 0 });
      this.avatars.push(state);
    }
    this.controller = this.world.createCharacterController(0.01);
    this.controller.enableAutostep(0.3, 0.2, false);
    this.controller.enableSnapToGround(0.3);
    this.controller.setSlideEnabled(true);
    // The broad phase is only populated by a step; queries before it see an empty world.
    this.world.step();
  }

  private randomXZ(): [number, number] {
    const { min, max } = this.walkable;
    return [min[0] + this.rng() * (max[0] - min[0]), min[1] + this.rng() * (max[1] - min[1])];
  }

  private randomPoint(): Vec3 {
    const [x, z] = this.randomXZ();
    return [x, 0.05, z];
  }

  step(dt: number, input: MoveInput): void {
    dt = Math.min(dt, 0.05);
    this.chars.forEach((ch, i) => {
      let vx = 0;
      let vz = 0;
      if (i === 0) {
        const fx = -Math.sin(this.camYaw), fz = -Math.cos(this.camYaw);
        const rx = Math.cos(this.camYaw), rz = -Math.sin(this.camYaw);
        vx = (fx * input.forward + rx * input.right) * PLAYER_SPEED;
        vz = (fz * input.forward + rz * input.right) * PLAYER_SPEED;
      } else {
        const p = ch.state.position;
        const dx = ch.target[0] - p[0], dz = ch.target[1] - p[2];
        const d = Math.hypot(dx, dz);
        if (d < 0.4 || ch.stuckTime > 1.5) {
          ch.target = this.randomXZ();
          ch.stuckTime = 0;
        } else {
          vx = (dx / d) * BOT_SPEED;
          vz = (dz / d) * BOT_SPEED;
        }
      }
      ch.vy = ch.grounded ? -1 : Math.max(ch.vy + GRAVITY * dt, -20);
      this.controller.computeColliderMovement(ch.collider, { x: vx * dt, y: ch.vy * dt, z: vz * dt });
      const m = this.controller.computedMovement();
      ch.grounded = this.controller.computedGrounded();
      const t = ch.body.translation();
      ch.body.setNextKinematicTranslation({ x: t.x + m.x, y: t.y + m.y, z: t.z + m.z });
      const moved = Math.hypot(m.x, m.z) / dt;
      const wanted = Math.hypot(vx, vz);
      if (i > 0 && wanted > 0 && moved < wanted * 0.3) ch.stuckTime += dt;
      ch.state.anim = moved > 0.3 ? 'Walk' : 'Idle';
      if (moved > 0.3) ch.state.yaw = Math.atan2(m.x, m.z);
      ch.state.position = [t.x + m.x, t.y + m.y - CENTER_Y, t.z + m.z];
    });
    this.world.step();
    this.updateCamera();
  }

  private updateCamera(): void {
    const p = this.avatars[0]!.position;
    const target: Vec3 = [p[0], p[1] + 1.5, p[2]];
    const dir: Vec3 = [Math.sin(this.camYaw) * Math.cos(this.camPitch), Math.sin(this.camPitch), Math.cos(this.camYaw) * Math.cos(this.camPitch)];
    let dist = this.camDistance;
    const ray = new RAPIER.Ray({ x: target[0], y: target[1], z: target[2] }, { x: dir[0], y: dir[1], z: dir[2] });
    // Only static geometry blocks the camera (characters are excluded via the kinematic filter).
    const hit = this.world.castRay(ray, dist, true, RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC);
    if (hit) dist = Math.max(0.5, hit.timeOfImpact - 0.2);
    this.camera.target = target;
    this.camera.position = [target[0] + dir[0] * dist, target[1] + dir[1] * dist, target[2] + dir[2] * dist];
  }
}
