import RAPIER from '@dimforge/rapier3d-deterministic-compat';
import { SIM_DT } from './config.ts';
import type { LevelDef } from './level.ts';
import type { Vec3 } from './math.ts';
import { eulerXYZToQuat } from './math.ts';

/**
 * Rapier module type. The cross-platform deterministic build is the project default (ADR-0003);
 * the standard build has the identical API and can be injected for comparisons.
 */
export type RapierApi = typeof RAPIER;

let ready: Promise<RapierApi> | undefined;

/** Instantiates the embedded WASM once per process/page. */
export function loadRapier(): Promise<RapierApi> {
  ready ??= RAPIER.init().then(() => RAPIER);
  return ready;
}

/** Static level colliders + query helpers. Owns the Rapier world; call `dispose()` to free WASM memory. */
export class PhysicsWorld {
  readonly rapier: RapierApi;
  readonly world: RAPIER.World;
  private disposed = false;

  constructor(rapier: RapierApi, level: LevelDef) {
    this.rapier = rapier;
    this.world = new rapier.World({ x: 0, y: 0, z: 0 });
    this.world.timestep = SIM_DT;
    for (const b of level.boxes) {
      const desc = rapier.ColliderDesc.cuboid(b.half.x, b.half.y, b.half.z).setTranslation(
        b.center.x,
        b.center.y,
        b.center.z,
      );
      if (b.rotation) desc.setRotation(eulerXYZToQuat(b.rotation));
      this.world.createCollider(desc);
    }
    // Query structures are only populated by a step; queries before it would see an empty world.
    this.world.step();
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  step(): void {
    this.world.step();
  }

  /**
   * Sweeps a sphere from `origin` along unit `dir` against static geometry only (characters are kinematic
   * and excluded). Returns the free distance, or `maxDistance` when nothing is hit.
   */
  sphereCast(origin: Vec3, dir: Vec3, radius: number, maxDistance: number): number {
    const hit = this.world.castShape(
      origin,
      { x: 0, y: 0, z: 0, w: 1 },
      dir,
      new this.rapier.Ball(radius),
      0,
      maxDistance,
      true,
      this.rapier.QueryFilterFlags.EXCLUDE_KINEMATIC,
    );
    return hit ? hit.time_of_impact : maxDistance;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.world.free();
  }
}
