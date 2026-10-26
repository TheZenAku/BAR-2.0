// Client-side prediction with server reconciliation (ADR-0005). The local Simulation runs every tick immediately
// (no input lag); each authoritative snapshot rewinds it to the server state and replays the inputs the server has
// not applied yet. Same game-core code on both sides, so on agreement the replay lands exactly where we were.
import type { CharacterState, MoveIntent, Simulation, Vec3 } from '@bar/game-core';
import { sanitizeIntent } from '@bar/game-core';
import { type InputFrame, LOCOMOTION_CODES, type SelfState } from '@bar/shared';

/** Unacknowledged inputs kept for replay (2 s). Older ones cannot matter: the server drops stale backlogs. */
const MAX_PENDING = 120;

export function selfToState(me: SelfState): CharacterState {
  const [x, y, z, yaw, vx, vz, verticalSpeed, grounded, loco] = me;
  return {
    position: { x, y, z },
    yaw,
    velocity: { x: vx, z: vz },
    verticalSpeed,
    grounded: grounded === 1,
    locomotion: LOCOMOTION_CODES[loco] ?? 'idle',
  };
}

export class Predictor {
  private readonly sim: Simulation;
  private readonly pending: { seq: number; intent: MoveIntent }[] = [];
  private nextSeq = 0;
  /** Snapshots that moved the predicted position by more than 1 mm. */
  corrections = 0;
  /** Size of the last such correction (m). */
  lastCorrection = 0;

  constructor(sim: Simulation) {
    this.sim = sim;
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  /** Runs one local tick and returns the frame to send. The intent is sanitized first, exactly as the server will. */
  tick(raw: MoveIntent): InputFrame {
    const intent = sanitizeIntent(raw);
    this.sim.tick(intent);
    const seq = this.nextSeq++;
    this.pending.push({ seq, intent });
    if (this.pending.length > MAX_PENDING) this.pending.shift();
    return [seq, intent.forward, intent.right, intent.run, intent.yaw];
  }

  /** New seat (not a reconnection): inputs sent before it never reached the new authoritative player. */
  clearPending(): void {
    this.pending.length = 0;
  }

  /**
   * Applies an authoritative state: rewinds to it and replays unacknowledged inputs.
   * Returns the visual jump this caused (predicted position before minus after), so the caller can smooth it.
   * `initial`: first state after joining (server-chosen spawn) — a placement, not counted as a correction.
   */
  reconcile(ack: number, me: SelfState, initial = false): Vec3 {
    while (this.pending.length > 0 && this.pending[0]!.seq <= ack) this.pending.shift();
    const before = this.sim.player.position;
    this.sim.restore(selfToState(me));
    for (const p of this.pending) this.sim.tick(p.intent);
    const after = this.sim.player.position;
    const jump = { x: before.x - after.x, y: before.y - after.y, z: before.z - after.z };
    const size = Math.hypot(jump.x, jump.y, jump.z);
    if (size > 1e-3 && !initial) {
      this.corrections++;
      this.lastCorrection = size;
    }
    return jump;
  }
}
