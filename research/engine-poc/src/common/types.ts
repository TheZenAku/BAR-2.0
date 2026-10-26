export type Vec3 = [number, number, number];

export interface AvatarState {
  position: Vec3; // feet position, world space
  yaw: number; // radians about +Y; 0 = facing +Z
  anim: 'Idle' | 'Walk';
}

export interface CameraState {
  position: Vec3;
  target: Vec3;
}

export interface PocOptions {
  avatars: number;
  shadows: boolean;
  bench: boolean;
  warmupMs: number;
  durationMs: number;
}

/** Hooks the adapter must call from inside its own frame loop. */
export interface FrameHooks {
  frameStart(): void;
  update(dtSeconds: number): void;
  frameEnd(): void;
}

/** Everything engine-specific lives behind this interface. */
export interface EngineAdapter {
  readonly engine: string;
  readonly version: string;
  init(canvas: HTMLCanvasElement, opts: PocOptions): Promise<void>;
  loadScene(url: string): Promise<void>;
  loadAvatars(url: string, count: number): Promise<void>;
  /** Called from FrameHooks.update with the simulation output for this frame. */
  apply(avatars: readonly AvatarState[], camera: CameraState, dt: number): void;
  start(hooks: FrameHooks): void;
  stats(): { drawCalls: number; triangles: number };
  resize(width: number, height: number): void;
}

export interface ColliderFile {
  version: number;
  walkable: { min: [number, number]; max: [number, number] };
  spawn: Vec3;
  colliders: { tag: string; min: Vec3; max: Vec3 }[];
}
