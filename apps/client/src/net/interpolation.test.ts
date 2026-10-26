import { SIM_HZ } from '@bar/game-core';
import type { RemoteState } from '@bar/shared';
import { describe, expect, it } from 'vitest';
import { type RemotePose, RemoteTrack, ServerClock } from './interpolation.ts';

const state = (x: number, yaw = 0, loco = 1): RemoteState => [7, x, 0, 0, yaw, 2, loco];
const pose = (): RemotePose => ({ position: { x: 0, y: 0, z: 0 }, yaw: 0, speed: 0, locomotion: 'idle' });

describe('RemoteTrack', () => {
  it('interpolates between the two snapshots around the render tick', () => {
    const track = new RemoteTrack();
    track.push(30, state(0));
    track.push(33, state(3, 0.3));
    const out = pose();
    expect(track.sample(31, out)).toBe(true);
    expect(out.position.x).toBeCloseTo(1);
    expect(out.yaw).toBeCloseTo(0.1);
    expect(out.locomotion).toBe('walk');
  });

  it('holds the newest pose when snapshots are late (no extrapolation) and the oldest before the buffer', () => {
    const track = new RemoteTrack();
    track.push(30, state(0));
    track.push(33, state(3));
    const out = pose();
    track.sample(50, out);
    expect(out.position.x).toBe(3);
    track.sample(10, out);
    expect(out.position.x).toBe(0);
  });

  it('ignores duplicated and out-of-order snapshots', () => {
    const track = new RemoteTrack();
    track.push(33, state(3));
    track.push(33, state(99));
    track.push(30, state(-99));
    expect(track.size).toBe(1);
  });

  it('takes the shortest arc for yaw across ±π', () => {
    const track = new RemoteTrack();
    track.push(0, state(0, Math.PI - 0.1));
    track.push(2, state(0, -Math.PI + 0.1));
    const out = pose();
    track.sample(1, out);
    expect(Math.abs(Math.abs(out.yaw) - Math.PI)).toBeLessThan(1e-9);
  });
});

describe('ServerClock', () => {
  it('locks to the first snapshot and filters jitter', () => {
    const clock = new ServerClock();
    expect(clock.synced).toBe(false);
    clock.observe(600, 1000); // server tick 600 seen at local 1 s
    expect(clock.tickAt(1000)).toBeCloseTo(600);
    expect(clock.tickAt(1500)).toBeCloseTo(600 + SIM_HZ / 2);
    clock.observe(663 + 3, 2050); // one snapshot 3 ticks "early": small, filtered
    expect(Math.abs(clock.tickAt(2050) - 663)).toBeLessThan(1);
  });

  it('resyncs at once after a large jump (reconnection, resumed tab)', () => {
    const clock = new ServerClock();
    clock.observe(600, 1000);
    clock.observe(5000, 2000);
    expect(clock.tickAt(2000)).toBeCloseTo(5000);
  });
});
