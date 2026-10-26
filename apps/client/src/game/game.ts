// Composition root of the vertical slice: wires input → simulation (fixed step) → avatar/camera → render.
// Each subsystem lives in its own module and is disposed here, in reverse order of creation.
import type { LevelDef, PlayerSnapshot, Vec3 } from '@bar/game-core';
import { FixedStepper, GREYBOX_BAR, lerpAngle, lerpVec3, loadRapier, SIM_DT, Simulation, vec3 } from '@bar/game-core';
import type { AvatarView } from '../avatar/avatar-view.ts';
import { TechnicalAvatar } from '../avatar/technical-avatar.ts';
import { ThirdPersonCamera } from '../camera/third-person-camera.ts';
import { DebugHud } from '../debug/debug-hud.ts';
import type { DebugSnapshot } from '../debug/debug-snapshot.ts';
import { FrameStats } from '../debug/frame-stats.ts';
import { InputController } from '../input/input.ts';
import type { GraphicsProfile } from '../render/graphics-profile.ts';
import { LevelView } from '../render/level-view.ts';
import { RenderStage } from '../render/render-stage.ts';

export interface GameOptions {
  canvas: HTMLCanvasElement;
  hudParent: HTMLElement;
  profile: GraphicsProfile;
  showHud: boolean;
  level?: LevelDef;
}

/** Longest frame fed to animation/camera smoothing (the simulation has its own clamp in FixedStepper). */
const MAX_RENDER_DT = 0.1;
/**
 * Catch-up budget per frame: 15 ticks = 250 ms. Slow frames (software rendering measured ~100 ms p95) still
 * advance in real time; only real stalls (tab hidden, debugger) drop time. A tick costs < 1 ms.
 */
const MAX_TICKS_PER_FRAME = 15;

const heapMB = (): number | null => {
  const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
  return mem ? mem.usedJSHeapSize / 1048576 : null;
};

export class Game {
  private readonly stage: RenderStage;
  private readonly sim: Simulation;
  private readonly levelView: LevelView;
  private readonly avatar: AvatarView;
  private readonly camera: ThirdPersonCamera;
  private readonly input: InputController;
  private readonly hud: DebugHud;
  private readonly stepper = new FixedStepper(SIM_DT, MAX_TICKS_PER_FRAME);
  private readonly frames = new FrameStats();
  private readonly cpu = new FrameStats(120);
  private readonly simCost = new FrameStats(600);
  private prev: PlayerSnapshot;
  private curr: PlayerSnapshot;
  private readonly feet: Vec3 = vec3(0, 0, 0);
  private raf = 0;
  private lastTime: number | null = null;
  private disposed = false;

  constructor(opts: GameOptions, rapier: Awaited<ReturnType<typeof loadRapier>>) {
    const level = opts.level ?? GREYBOX_BAR;
    this.stage = new RenderStage(opts.canvas, opts.profile);
    this.sim = new Simulation(rapier, level);
    this.levelView = new LevelView(level, opts.profile.shadows);
    this.stage.scene.add(this.levelView.root);
    this.avatar = new TechnicalAvatar(undefined, opts.profile.shadows);
    this.stage.scene.add(this.avatar.object);
    this.camera = new ThirdPersonCamera(this.stage.camera, level.spawnYaw);
    this.input = new InputController(window, opts.canvas);
    this.hud = new DebugHud(opts.hudParent, opts.showHud);
    this.prev = this.curr = this.sim.player;
  }

  start(): void {
    this.raf = requestAnimationFrame(this.frame);
  }

  private readonly frame = (now: number): void => {
    if (this.disposed) return;
    const t0 = performance.now();
    const dt = this.lastTime === null ? 0 : (now - this.lastTime) / 1000;
    this.lastTime = now;
    if (dt > 0) this.frames.push(dt * 1000);

    const look = this.input.consumeLook();
    this.camera.applyLook(look.dx, look.dy, look.zoom);
    // Intent is sampled once per frame; every tick in this frame uses it (same as a server would).
    const intent = { ...this.input.axes, yaw: this.camera.yaw };
    let ticks = 0;
    const s0 = performance.now();
    const alpha = this.stepper.advance(dt, () => {
      this.prev = this.curr;
      this.curr = this.sim.tick(intent);
      ticks++;
    });
    if (ticks > 0) this.simCost.push((performance.now() - s0) / ticks);

    lerpVec3(this.prev.position, this.curr.position, alpha, this.feet);
    const renderDt = Math.min(dt, MAX_RENDER_DT);
    this.avatar.setPose(this.feet, lerpAngle(this.prev.yaw, this.curr.yaw, alpha));
    this.avatar.setLocomotion(this.curr.locomotion, this.curr.speed);
    this.avatar.update(renderDt);
    this.camera.update(this.feet, renderDt, (o, d, r, max) => this.sim.physics.sphereCast(o, d, r, max));
    this.stage.render();
    this.cpu.push(performance.now() - t0);
    this.hud.update(now, () => this.snapshot());
    this.raf = requestAnimationFrame(this.frame);
  };

  snapshot(): DebugSnapshot {
    return {
      player: this.curr,
      animation: this.avatar.activeAnimation,
      frame: this.frames.summary(),
      cpuMs: this.cpu.summary().avgMs,
      simAvgMs: this.simCost.summary().avgMs,
      droppedTicks: this.stepper.droppedTicks,
      render: this.stage.info(),
      heapMB: heapMB(),
      profile: this.stage.profile.name,
      cameraDistance: this.camera.distance,
    };
  }

  /** Clears frame statistics (e.g. after loading, before a measurement window). */
  resetStats(): void {
    this.frames.reset();
    this.cpu.reset();
    this.simCost.reset();
  }

  /**
   * Releases every listener, GPU and physics resource. Returns GPU objects still alive just before the
   * renderer itself is destroyed, so tests can assert nothing leaked.
   */
  dispose(): { geometries: number; textures: number } {
    if (this.disposed) return { geometries: 0, textures: 0 };
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.hud.dispose();
    this.input.dispose();
    this.avatar.dispose();
    this.levelView.dispose();
    this.sim.dispose();
    return this.stage.dispose();
  }
}

export async function startGame(opts: GameOptions): Promise<Game> {
  const game = new Game(opts, await loadRapier());
  game.start();
  return game;
}
