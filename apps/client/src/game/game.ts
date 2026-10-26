// Composition root of the scene: wires input → predicted simulation (fixed step) → avatar/camera → render, and the
// room connection (M3): intents out, authoritative snapshots in (reconciliation for us, interpolation for others).
// Each subsystem lives in its own module and is disposed here, in reverse order of creation.
import type { LevelDef, PlayerSnapshot, Vec3 } from '@bar/game-core';
import {
  FixedStepper,
  GREYBOX_BAR,
  lerpAngle,
  lerpVec3,
  loadRapier,
  SIM_DT,
  SIM_HZ,
  Simulation,
  vec3,
} from '@bar/game-core';
import type { InputFrame, Roster, Snapshot } from '@bar/shared';
import type { AvatarView } from '../avatar/avatar-view.ts';
import { TechnicalAvatar } from '../avatar/technical-avatar.ts';
import { ThirdPersonCamera } from '../camera/third-person-camera.ts';
import { DebugHud } from '../debug/debug-hud.ts';
import type { DebugSnapshot, NetDebug } from '../debug/debug-snapshot.ts';
import { FrameStats } from '../debug/frame-stats.ts';
import { InputController } from '../input/input.ts';
import { GameConnection, type NetStatus } from '../net/game-connection.ts';
import { INTERP_DELAY_TICKS, ServerClock } from '../net/interpolation.ts';
import { NetBadge } from '../net/net-badge.ts';
import { Predictor } from '../net/prediction.ts';
import type { GraphicsProfile } from '../render/graphics-profile.ts';
import { LevelView } from '../render/level-view.ts';
import { RenderStage } from '../render/render-stage.ts';
import { RemotePlayers } from './remote-players.ts';

export interface GameOptions {
  canvas: HTMLCanvasElement;
  hudParent: HTMLElement;
  profile: GraphicsProfile;
  showHud: boolean;
  level?: LevelDef;
  /** Join the shared room (default true). Without it the scene runs locally, as in M1. */
  online?: boolean;
  /** The server ended this session (logout elsewhere, expiry, password reset). */
  onSessionEnded?: () => void;
}

/** Longest frame fed to animation/camera smoothing (the simulation has its own clamp in FixedStepper). */
const MAX_RENDER_DT = 0.1;
/**
 * Catch-up budget per frame: 15 ticks = 250 ms. Slow frames (software rendering measured ~100 ms p95) still
 * advance in real time; only real stalls (tab hidden, debugger) drop time. A tick costs < 1 ms.
 */
const MAX_TICKS_PER_FRAME = 15;
/** Input frames are flushed in pairs (30 messages/s), or sooner if a frame produced none for a while. */
const FLUSH_FRAMES = 2;
const FLUSH_MAX_WAIT_MS = 50;
/** Reconciliation jumps are hidden by easing the rendered position back over ~100 ms; larger ones snap. */
const CORRECTION_DECAY_PER_S = 10;
const SNAP_CORRECTION_M = 2;

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
  private readonly predictor: Predictor;
  private readonly remotes: RemotePlayers;
  private readonly clock = new ServerClock();
  private readonly net: GameConnection | undefined;
  private readonly badge: NetBadge | undefined;
  private roster: Roster = { players: [], max: 0 };
  private selfPid: number | undefined;
  /** False until the first snapshot of a new identity places us on the server's spawn spot. */
  private placed = false;
  private lastSnapshotTick = -1;
  private pendingSelf: Snapshot | undefined;
  private outbox: InputFrame[] = [];
  private lastFlush = 0;
  /** Rendered minus simulated position after a correction; decays to zero. */
  private readonly correction: Vec3 = vec3(0, 0, 0);
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
    this.predictor = new Predictor(this.sim);
    this.remotes = new RemotePlayers(this.stage.scene, opts.profile.shadows);
    this.prev = this.curr = this.sim.player;
    if (opts.online !== false) {
      this.badge = new NetBadge(opts.hudParent);
      this.net = new GameConnection({
        welcome: (w) => {
          if (w.you !== this.selfPid) {
            // New seat (not a reconnection): new spawn, and earlier inputs never reached this player.
            this.placed = false;
            this.predictor.clearPending();
          }
          this.selfPid = w.you;
          this.lastSnapshotTick = -1;
          this.setRoster(w);
        },
        roster: (r) => this.setRoster(r),
        snapshot: (snap, at) => {
          if (snap.t <= this.lastSnapshotTick) return;
          this.lastSnapshotTick = snap.t;
          this.clock.observe(snap.t, at);
          this.remotes.push(snap.t, snap.p);
          this.pendingSelf = snap;
        },
        status: (st) => {
          this.updateBadge(st);
          if (st === 'session-ended') opts.onSessionEnded?.();
        },
      });
    }
  }

  private setRoster(r: Roster): void {
    this.roster = r;
    this.remotes.setRoster(r.players, this.selfPid);
    if (this.net) this.updateBadge(this.net.status);
  }

  private updateBadge(st: NetStatus): void {
    this.badge?.update(st, this.roster.players.length, this.roster.max);
  }

  /** Rewinds to the newest authoritative state and replays pending inputs; the visual jump is eased out. */
  private reconcile(): void {
    const snap = this.pendingSelf;
    if (!snap) return;
    this.pendingSelf = undefined;
    const initial = !this.placed;
    this.placed = true;
    const jump = this.predictor.reconcile(snap.a, snap.me, initial);
    if (initial) {
      this.prev = this.curr = this.sim.player; // a spawn is a teleport: nothing to smooth
      return;
    }
    const c = this.correction;
    c.x += jump.x;
    c.y += jump.y;
    c.z += jump.z;
    if (Math.hypot(c.x, c.y, c.z) > SNAP_CORRECTION_M) c.x = c.y = c.z = 0;
    const p = this.prev.position;
    this.prev = { ...this.prev, position: vec3(p.x - jump.x, p.y - jump.y, p.z - jump.z) };
    this.curr = this.sim.player;
  }

  private flushInputs(now: number): void {
    if (this.outbox.length === 0) return;
    if (this.outbox.length < FLUSH_FRAMES && now - this.lastFlush < FLUSH_MAX_WAIT_MS) return;
    this.net?.send(this.outbox);
    this.outbox = [];
    this.lastFlush = now;
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
    // Intent is sampled once per frame; every tick in this frame uses it (the server applies the same frames).
    const intent = { ...this.input.axes, yaw: this.camera.yaw };
    let ticks = 0;
    const s0 = performance.now();
    this.reconcile();
    const alpha = this.stepper.advance(dt, () => {
      this.prev = this.curr;
      this.outbox.push(this.predictor.tick(intent));
      this.curr = this.sim.player;
      ticks++;
    });
    if (ticks > 0) this.simCost.push((performance.now() - s0) / ticks);
    this.flushInputs(now);

    const renderDt = Math.min(dt, MAX_RENDER_DT);
    const decay = Math.exp(-CORRECTION_DECAY_PER_S * renderDt);
    this.correction.x *= decay;
    this.correction.y *= decay;
    this.correction.z *= decay;
    lerpVec3(this.prev.position, this.curr.position, alpha, this.feet);
    this.feet.x += this.correction.x;
    this.feet.y += this.correction.y;
    this.feet.z += this.correction.z;
    if (this.clock.synced) this.remotes.update(this.clock.tickAt(now) - INTERP_DELAY_TICKS, renderDt);
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
      net: this.netDebug(),
    };
  }

  private netDebug(): NetDebug | null {
    if (!this.net) return null;
    return {
      ...this.net.stats(),
      you: this.selfPid ?? null,
      players: this.roster.players.length,
      maxPlayers: this.roster.max,
      pendingInputs: this.predictor.pendingCount,
      corrections: this.predictor.corrections,
      lastCorrectionCm: this.predictor.lastCorrection * 100,
      interpDelayMs: Math.round((INTERP_DELAY_TICKS / SIM_HZ) * 1000),
      remotes: this.remotes.info(),
    };
  }

  /** Test hook: drops the socket like a network failure would (automatic reconnection follows). */
  simulateNetworkDrop(): void {
    this.net?.simulateDrop();
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
    this.net?.dispose();
    this.badge?.dispose();
    this.remotes.dispose();
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
