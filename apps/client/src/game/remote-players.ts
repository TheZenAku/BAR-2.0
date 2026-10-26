// Other players in the room: one technical avatar each (orange, with a name tag) driven by interpolated snapshots.
// Only position/yaw/locomotion arrive over the network; animation runs locally (no bones on the wire).
import type { Vec3 } from '@bar/game-core';
import type { RemoteState, RosterEntry } from '@bar/shared';
import { CanvasTexture, type Scene, Sprite, SpriteMaterial } from 'three';
import { TechnicalAvatar } from '../avatar/technical-avatar.ts';
import { type RemotePose, RemoteTrack } from '../net/interpolation.ts';

/** Remote avatars use a warm color; the local player keeps the default blue. */
export const REMOTE_COLOR = 0xd4823d;
const TAG_HEIGHT = 2.05;

class NameTag {
  readonly sprite: Sprite;
  private readonly texture: CanvasTexture;
  private readonly material: SpriteMaterial;

  constructor(name: string) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 48;
    const g = canvas.getContext('2d')!;
    g.fillStyle = 'rgba(0,0,0,0.55)';
    g.beginPath();
    g.roundRect(0, 4, 256, 40, 12);
    g.fill();
    g.font = '600 24px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#f3e9dc';
    g.fillText(name, 128, 25, 240);
    this.texture = new CanvasTexture(canvas);
    this.material = new SpriteMaterial({ map: this.texture, depthWrite: false, transparent: true });
    this.sprite = new Sprite(this.material);
    this.sprite.scale.set(1.28, 0.24, 1);
    this.sprite.position.y = TAG_HEIGHT;
  }

  dispose(): void {
    this.sprite.removeFromParent();
    this.material.dispose();
    this.texture.dispose();
  }
}

interface Remote {
  entry: RosterEntry;
  avatar: TechnicalAvatar;
  tag: NameTag;
  track: RemoteTrack;
  pose: RemotePose;
  visible: boolean;
}

export interface RemoteInfo {
  pid: number;
  name: string;
  position: Vec3;
  locomotion: string;
  animation: string;
}

export class RemotePlayers {
  private readonly scene: Scene;
  private readonly shadows: boolean;
  private readonly remotes = new Map<number, Remote>();

  constructor(scene: Scene, shadows: boolean) {
    this.scene = scene;
    this.shadows = shadows;
  }

  get count(): number {
    return this.remotes.size;
  }

  /** Adds/removes avatars to match the roster (the local player is excluded). */
  setRoster(players: readonly RosterEntry[], selfPid: number | undefined): void {
    const wanted = new Map(players.filter((p) => p.pid !== selfPid).map((p) => [p.pid, p]));
    for (const [pid, r] of this.remotes) if (!wanted.has(pid)) this.remove(pid, r);
    for (const [pid, entry] of wanted) {
      if (this.remotes.has(pid)) continue;
      const avatar = new TechnicalAvatar(REMOTE_COLOR, this.shadows);
      const tag = new NameTag(entry.name);
      avatar.object.add(tag.sprite);
      avatar.object.visible = false; // until its first snapshot
      this.scene.add(avatar.object);
      this.remotes.set(pid, {
        entry,
        avatar,
        tag,
        track: new RemoteTrack(),
        pose: { position: { x: 0, y: 0, z: 0 }, yaw: 0, speed: 0, locomotion: 'idle' },
        visible: false,
      });
    }
  }

  push(tick: number, states: readonly RemoteState[]): void {
    for (const s of states) this.remotes.get(s[0])?.track.push(tick, s);
  }

  update(renderTick: number, dt: number): void {
    for (const r of this.remotes.values()) {
      if (!r.track.sample(renderTick, r.pose)) continue;
      if (!r.visible) r.avatar.object.visible = r.visible = true;
      r.avatar.setPose(r.pose.position, r.pose.yaw);
      r.avatar.setLocomotion(r.pose.locomotion, r.pose.speed);
      r.avatar.update(dt);
    }
  }

  info(): RemoteInfo[] {
    return [...this.remotes.values()].map((r) => ({
      pid: r.entry.pid,
      name: r.entry.name,
      position: { ...r.pose.position },
      locomotion: r.pose.locomotion,
      animation: r.avatar.activeAnimation,
    }));
  }

  dispose(): void {
    for (const [pid, r] of this.remotes) this.remove(pid, r);
  }

  private remove(pid: number, r: Remote): void {
    r.tag.dispose();
    r.avatar.dispose();
    this.remotes.delete(pid);
  }
}
