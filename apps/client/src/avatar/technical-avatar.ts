// Temporary technical character: primitive "mannequin" with named joints animated through the regular
// Three.js animation system (AnimationClip + AnimationMixer). A GLB rig with the same clip names
// (idle/walk/run) can replace it behind AvatarView. Not art.
import type { Locomotion, Vec3 } from '@bar/game-core';
import { MOVEMENT } from '@bar/game-core';
import type { AnimationAction, BufferGeometry, Material } from 'three';
import {
  AnimationClip,
  AnimationMixer,
  BoxGeometry,
  Group,
  LoopRepeat,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  QuaternionKeyframeTrack,
  SphereGeometry,
  Vector3,
  VectorKeyframeTrack,
} from 'three';
import type { AvatarView } from './avatar-view.ts';

const HIP_Y = 0.92;
const FADE_SECONDS = 0.2;

interface Gait {
  period: number;
  legSwing: number;
  armSwing: number;
  bob: number;
  lean: number;
}

const GAITS: Record<Locomotion, Gait> = {
  idle: { period: 2.4, legSwing: 0, armSwing: 0.04, bob: 0.008, lean: 0 },
  walk: { period: 1.0, legSwing: 0.45, armSwing: 0.35, bob: 0.03, lean: 0.04 },
  run: { period: 0.62, legSwing: 0.8, armSwing: 0.7, bob: 0.06, lean: 0.18 },
};

/** Nominal speed each clip was authored for; playback rate scales with real speed to limit foot sliding. */
const NOMINAL_SPEED: Record<Locomotion, number> = { idle: 1, walk: MOVEMENT.walkSpeed, run: MOVEMENT.runSpeed };

const X = new Vector3(1, 0, 0);

/** Procedural clip: sampled sine swings on named joints. Exported for tests. */
export function buildClip(name: Locomotion, g: Gait = GAITS[name], samples = 16): AnimationClip {
  const times: number[] = [];
  for (let i = 0; i <= samples; i++) times.push((g.period * i) / samples);
  const rotX = (fn: (phase: number) => number) =>
    times.flatMap((t) => new Quaternion().setFromAxisAngle(X, fn((2 * Math.PI * t) / g.period)).toArray());
  const tracks = [
    new QuaternionKeyframeTrack(
      'legL.quaternion',
      times,
      rotX((p) => Math.sin(p) * g.legSwing),
    ),
    new QuaternionKeyframeTrack(
      'legR.quaternion',
      times,
      rotX((p) => -Math.sin(p) * g.legSwing),
    ),
    new QuaternionKeyframeTrack(
      'armL.quaternion',
      times,
      rotX((p) => -Math.sin(p) * g.armSwing),
    ),
    new QuaternionKeyframeTrack(
      'armR.quaternion',
      times,
      rotX((p) => Math.sin(p) * g.armSwing),
    ),
    new QuaternionKeyframeTrack(
      'spine.quaternion',
      times,
      rotX(() => g.lean),
    ),
    new VectorKeyframeTrack(
      'hips.position',
      times,
      times.flatMap((t) => [0, HIP_Y + Math.abs(Math.cos((2 * Math.PI * t) / g.period)) * g.bob, 0]),
    ),
  ];
  return new AnimationClip(name, g.period, tracks);
}

export class TechnicalAvatar implements AvatarView {
  readonly object = new Group();
  private readonly mixer: AnimationMixer;
  private readonly actions: Record<Locomotion, AnimationAction>;
  private readonly geometries: BufferGeometry[] = [];
  private readonly materials: Material[] = [];
  private current: Locomotion = 'idle';

  constructor(color = 0x3d8bd4, shadows = true) {
    this.object.name = 'technical-avatar';
    const body = new MeshStandardMaterial({ color, roughness: 0.6 });
    const limbs = new MeshStandardMaterial({ color: 0x2a2f38, roughness: 0.8 });
    const skin = new MeshStandardMaterial({ color: 0xe0b48c, roughness: 0.7 });
    const sleeves = new MeshStandardMaterial({ color: 0x24537f, roughness: 0.6 });
    this.materials.push(body, limbs, skin, sleeves);

    const joint = (name: string, parent: Object3D, x: number, y: number, z: number) => {
      const o = new Object3D();
      o.name = name;
      o.position.set(x, y, z);
      parent.add(o);
      return o;
    };
    const part = (parent: Object3D, geo: BufferGeometry, mat: Material, y: number, z = 0) => {
      this.geometries.push(geo);
      const mesh = new Mesh(geo, mat);
      mesh.position.set(0, y, z);
      mesh.castShadow = shadows;
      parent.add(mesh);
      return mesh;
    };

    const hips = joint('hips', this.object, 0, HIP_Y, 0);
    const spine = joint('spine', hips, 0, 0.02, 0);
    part(spine, new BoxGeometry(0.42, 0.55, 0.24), body, 0.3);
    part(spine, new SphereGeometry(0.13, 16, 12), skin, 0.72);
    part(spine, new BoxGeometry(0.06, 0.05, 0.06), limbs, 0.72, 0.13); // nose: shows facing (+Z)
    const limb = new BoxGeometry(0.12, 0.6, 0.12);
    const arm = new BoxGeometry(0.09, 0.55, 0.09);
    for (const [side, x] of [
      ['L', 0.1],
      ['R', -0.1],
    ] as const) {
      part(joint(`leg${side}`, hips, x, -0.02, 0), limb, limbs, -0.32);
      part(joint(`arm${side}`, spine, x * 2.6, 0.54, 0), arm, sleeves, -0.27);
    }
    this.geometries.push(limb, arm);

    this.mixer = new AnimationMixer(this.object);
    const make = (name: Locomotion) => {
      const a = this.mixer.clipAction(buildClip(name));
      a.setLoop(LoopRepeat, Number.POSITIVE_INFINITY);
      a.play();
      a.setEffectiveWeight(name === 'idle' ? 1 : 0);
      return a;
    };
    this.actions = { idle: make('idle'), walk: make('walk'), run: make('run') };
  }

  get activeAnimation(): Locomotion {
    return this.current;
  }

  setPose(feet: Vec3, yaw: number): void {
    this.object.position.set(feet.x, feet.y, feet.z);
    this.object.rotation.y = yaw;
  }

  setLocomotion(state: Locomotion, speed: number): void {
    if (state !== this.current) {
      // Keep the gait phase when switching walk <-> run so feet don't jump.
      if (state !== 'idle' && this.current !== 'idle') {
        const from = this.actions[this.current];
        const to = this.actions[state];
        to.time = (from.time / from.getClip().duration) * to.getClip().duration;
      }
      this.current = state;
    }
    if (state !== 'idle') this.actions[state].timeScale = Math.min(Math.max(speed / NOMINAL_SPEED[state], 0.5), 1.6);
  }

  update(dt: number): void {
    // Linear weight blending toward the active clip. Unlike crossFadeTo, this never restarts a fade from zero
    // when the state flips back mid-transition, so rapid changes don't pop.
    const step = dt / FADE_SECONDS;
    for (const [name, action] of Object.entries(this.actions) as [Locomotion, AnimationAction][]) {
      const target = name === this.current ? 1 : 0;
      const w = action.getEffectiveWeight();
      action.setEffectiveWeight(target > w ? Math.min(target, w + step) : Math.max(target, w - step));
    }
    this.mixer.update(dt);
  }

  dispose(): void {
    this.mixer.stopAllAction();
    for (const a of Object.values(this.actions)) this.mixer.uncacheClip(a.getClip());
    this.mixer.uncacheRoot(this.object);
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.object.removeFromParent();
    this.object.clear();
  }
}
