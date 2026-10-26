// Remote players are drawn slightly in the past, between two received snapshots, so their motion stays smooth
// despite 20 Hz updates and network jitter. Nothing here is extrapolated: a late snapshot holds the last pose.
import { type Locomotion, lerp, lerpAngle, SIM_HZ, type Vec3 } from '@bar/game-core';
import { LOCOMOTION_CODES, type RemoteState } from '@bar/shared';

/** Render delay behind the newest server tick: 2 snapshot intervals (100 ms) absorb one late or lost update. */
export const INTERP_DELAY_TICKS = 6;

/** Estimates the server tick "now" from snapshot arrivals (smoothed: one late packet does not shift the clock). */
export class ServerClock {
  private offset: number | undefined;

  observe(serverTick: number, nowMs: number): void {
    const o = serverTick - (nowMs / 1000) * SIM_HZ;
    // Large jumps (first snapshot, reconnection, tab resumed) resync at once; small ones are filtered.
    if (this.offset === undefined || Math.abs(o - this.offset) > SIM_HZ / 2) this.offset = o;
    else this.offset += (o - this.offset) * 0.05;
  }

  get synced(): boolean {
    return this.offset !== undefined;
  }

  tickAt(nowMs: number): number {
    return (nowMs / 1000) * SIM_HZ + (this.offset ?? 0);
  }
}

export interface RemotePose {
  position: Vec3;
  yaw: number;
  speed: number;
  locomotion: Locomotion;
}

interface Sample extends RemotePose {
  t: number;
}

const toSample = (t: number, r: RemoteState): Sample => ({
  t,
  position: { x: r[1], y: r[2], z: r[3] },
  yaw: r[4],
  speed: r[5],
  locomotion: LOCOMOTION_CODES[r[6]] ?? 'idle',
});

/** Snapshot history of one remote player. */
export class RemoteTrack {
  private readonly samples: Sample[] = [];

  push(t: number, state: RemoteState): void {
    const last = this.samples.at(-1);
    if (last && t <= last.t) return; // duplicate or out of order
    this.samples.push(toSample(t, state));
    if (this.samples.length > 40) this.samples.shift();
  }

  get size(): number {
    return this.samples.length;
  }

  /** Pose at server tick `t` (fractional), written into `out`. */
  sample(t: number, out: RemotePose): boolean {
    const s = this.samples;
    if (s.length === 0) return false;
    let i = s.length - 1;
    while (i > 0 && s[i]!.t > t) i--;
    const a = s[i]!;
    const b = s[i + 1];
    if (!b || t <= a.t) {
      copy(t < a.t ? a : (b ?? a), out);
      return true;
    }
    const k = (t - a.t) / (b.t - a.t);
    out.position.x = lerp(a.position.x, b.position.x, k);
    out.position.y = lerp(a.position.y, b.position.y, k);
    out.position.z = lerp(a.position.z, b.position.z, k);
    out.yaw = lerpAngle(a.yaw, b.yaw, k);
    out.speed = lerp(a.speed, b.speed, k);
    out.locomotion = k < 0.5 ? a.locomotion : b.locomotion;
    return true;
  }
}

function copy(s: Sample, out: RemotePose): void {
  out.position.x = s.position.x;
  out.position.y = s.position.y;
  out.position.z = s.position.z;
  out.yaw = s.yaw;
  out.speed = s.speed;
  out.locomotion = s.locomotion;
}
