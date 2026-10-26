// Authoritative multiplayer simulation, free of networking so it can be tested directly. Each player runs the same
// game-core Simulation the client predicts with (one physics world per player: players do not collide, ADR-0005).
import { IDLE_INTENT, type LevelDef, type MoveIntent, type RapierApi, Simulation, type Vec3 } from '@bar/game-core';
import { type InputFrame, LOCOMOTION_CODES, type RemoteState, type RosterEntry, type Snapshot } from '@bar/shared';

// Time budget (anti speed hack): every server tick grants one tick of simulation time; each applied input spends one.
// Inputs are applied as they arrive while there is budget, so the server replays exactly the client's sequence
// (prediction then agrees bit for bit) yet can never move a player faster than real time allows. The budget cap is
// the only tolerance: it absorbs network jitter and client frame hitches (the client catches up 15 ticks at most).

/** Budget cap in ticks (250 ms). Also how long a silent client keeps its pose before the server idles it. */
export const BUDGET_MAX_TICKS = 15;
/** Catch-up rate after a burst: at most this many inputs per server tick. */
export const MAX_STEPS_PER_TICK = 4;
/** Queued inputs beyond this are stale: the oldest are dropped and the client reconciles. */
export const INPUT_BACKLOG_MAX = 20;

export interface PlayerIdentity {
  /** Internal account id: never sent to clients. */
  userId: string;
  publicId: string;
  displayName: string;
}

const mm = (v: number) => Math.round(v * 1000) / 1000;
const loco = (l: string) => LOCOMOTION_CODES.indexOf(l as (typeof LOCOMOTION_CODES)[number]);

export class WorldPlayer {
  readonly pid: number;
  readonly identity: PlayerIdentity;
  readonly sim: Simulation;
  /** Last input seq applied (sent back as the ack; -1 before the first). */
  ackSeq = -1;
  readonly counters = { applied: 0, duplicates: 0, dropped: 0, idleSteps: 0 };
  private readonly queue: { seq: number; intent: MoveIntent }[] = [];
  /** Highest seq ever accepted: anything at or below it is a duplicate or a replay. */
  private newestSeq = -1;
  /** Simulation ticks this player may still run (see BUDGET_MAX_TICKS). */
  private budget = 0;
  private silentTicks = 0;

  constructor(pid: number, identity: PlayerIdentity, sim: Simulation) {
    this.pid = pid;
    this.identity = identity;
    this.sim = sim;
  }

  /** Frames must already be schema-validated. Positions are never accepted: only intents exist on the wire. */
  enqueue(frames: readonly InputFrame[]): void {
    for (const [seq, forward, right, run, yaw] of frames) {
      if (seq <= this.newestSeq) {
        this.counters.duplicates++;
        continue;
      }
      this.newestSeq = seq;
      this.queue.push({ seq, intent: { forward, right, run, yaw } });
    }
    const excess = this.queue.length - INPUT_BACKLOG_MAX;
    if (excess > 0) {
      this.queue.splice(0, excess);
      this.counters.dropped += excess;
    }
  }

  /** One server tick: applies queued inputs within the time budget. Input volume cannot buy speed. */
  step(): void {
    this.budget = Math.min(this.budget + 1, BUDGET_MAX_TICKS);
    let applied = 0;
    while (applied < MAX_STEPS_PER_TICK && this.budget >= 1 && this.queue.length > 0) {
      const next = this.queue.shift()!;
      this.sim.tick(next.intent);
      this.ackSeq = next.seq;
      this.budget--;
      this.counters.applied++;
      applied++;
    }
    if (applied > 0) {
      this.silentTicks = 0;
    } else if (++this.silentTicks > BUDGET_MAX_TICKS) {
      // Silent for longer than the jitter allowance (hidden tab, dead link): time moves on and the player stops.
      // The idle step spends budget too, so silence never turns into a burst of extra speed later.
      this.sim.tick(IDLE_INTENT);
      this.budget = Math.max(0, this.budget - 1);
      this.counters.idleSteps++;
    }
  }

  remoteState(): RemoteState {
    const p = this.sim.player;
    return [this.pid, mm(p.position.x), mm(p.position.y), mm(p.position.z), mm(p.yaw), mm(p.speed), loco(p.locomotion)];
  }
}

export class GameWorld {
  readonly level: LevelDef;
  tick = 0;
  private readonly rapier: RapierApi;
  private readonly players = new Map<number, WorldPlayer>();
  private nextPid = 1;

  constructor(rapier: RapierApi, level: LevelDef) {
    this.rapier = rapier;
    this.level = level;
  }

  get size(): number {
    return this.players.size;
  }

  get(pid: number): WorldPlayer | undefined {
    return this.players.get(pid);
  }

  add(identity: PlayerIdentity): WorldPlayer {
    const sim = new Simulation(this.rapier, this.level);
    sim.teleport(this.pickSpawn());
    const player = new WorldPlayer(this.nextPid++, identity, sim);
    this.players.set(player.pid, player);
    return player;
  }

  remove(pid: number): boolean {
    const player = this.players.get(pid);
    if (!player) return false;
    player.sim.dispose();
    return this.players.delete(pid);
  }

  step(): void {
    this.tick++;
    for (const p of this.players.values()) p.step();
  }

  roster(): RosterEntry[] {
    return [...this.players.values()].map((p) => ({
      pid: p.pid,
      id: p.identity.publicId,
      name: p.identity.displayName,
    }));
  }

  /** One pass per snapshot: every player's public state (each recipient skips its own entry). */
  remoteStates(): RemoteState[] {
    return [...this.players.values()].map((p) => p.remoteState());
  }

  snapshotFor(player: WorldPlayer, all: readonly RemoteState[]): Snapshot {
    const s = player.sim.state();
    return {
      t: this.tick,
      a: player.ackSeq,
      me: [
        s.position.x,
        s.position.y,
        s.position.z,
        s.yaw,
        s.velocity.x,
        s.velocity.z,
        s.verticalSpeed,
        s.grounded ? 1 : 0,
        loco(s.locomotion),
      ],
      p: all.filter((r) => r[0] !== player.pid),
    };
  }

  dispose(): void {
    for (const pid of [...this.players.keys()]) this.remove(pid);
  }

  /** The spawn spot farthest from everyone already in the room. */
  private pickSpawn(): Vec3 {
    const spots = this.level.spawnPoints?.length ? this.level.spawnPoints : [this.level.spawn];
    let best = spots[0]!;
    let bestDist = -1;
    for (const s of spots) {
      let nearest = Number.POSITIVE_INFINITY;
      for (const p of this.players.values()) {
        const q = p.sim.player.position;
        nearest = Math.min(nearest, Math.hypot(q.x - s.x, q.z - s.z));
      }
      if (nearest > bestDist) {
        bestDist = nearest;
        best = s;
      }
    }
    return best;
  }
}
