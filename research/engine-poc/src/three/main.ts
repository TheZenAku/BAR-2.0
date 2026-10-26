import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { runPoc } from '../common/run';
import type { AvatarState, CameraState, EngineAdapter, FrameHooks, PocOptions } from '../common/types';

interface Avatar {
  root: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  actions: Record<string, THREE.AnimationAction>;
  current: string;
}

class ThreeAdapter implements EngineAdapter {
  readonly engine = 'three';
  readonly version = THREE.REVISION;
  private renderer!: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 100);
  private loader = new GLTFLoader();
  private avatars: Avatar[] = [];
  private sun!: THREE.DirectionalLight;

  async init(canvas: HTMLCanvasElement, opts: PocOptions): Promise<void> {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(1);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = opts.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene.background = new THREE.Color(0x1a1410);
    this.scene.fog = new THREE.FogExp2(0x1a1410, 0.02);
    this.scene.add(new THREE.HemisphereLight(0x8090b0, 0x302018, 1.0));
    this.sun = new THREE.DirectionalLight(0xfff1d6, 2.0);
    this.sun.position.set(-5, 10, 4);
    this.sun.castShadow = opts.shadows;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, near: 0.5, far: 30 });
    this.sun.shadow.bias = -0.0005;
    this.scene.add(this.sun, this.sun.target);
    for (const [x, z] of [[-6, 0], [4, 0], [-1, 4], [-2, -4.5]] as const) {
      const l = new THREE.PointLight(0xffb060, 6, 8, 2);
      l.position.set(x, 2.8, z);
      this.scene.add(l);
    }
  }

  async loadScene(url: string): Promise<void> {
    const gltf = await this.loader.loadAsync(url);
    gltf.scene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = o.receiveShadow = true;
    });
    this.scene.add(gltf.scene);
  }

  async loadAvatars(url: string, count: number): Promise<void> {
    const gltf = await this.loader.loadAsync(url);
    for (let i = 0; i < count; i++) {
      const root = cloneSkinned(gltf.scene);
      root.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          o.castShadow = true;
          o.frustumCulled = false; // skinned bounds are bind-pose only
        }
      });
      const mixer = new THREE.AnimationMixer(root);
      const actions = Object.fromEntries(gltf.animations.map((c) => [c.name, mixer.clipAction(c)]));
      actions['Idle']!.play();
      actions['Walk']!.play().setEffectiveWeight(0);
      this.scene.add(root);
      this.avatars.push({ root, mixer, actions, current: 'Idle' });
    }
  }

  apply(states: readonly AvatarState[], cam: CameraState, dt: number): void {
    states.forEach((s, i) => {
      const a = this.avatars[i]!;
      a.root.position.set(...s.position);
      a.root.rotation.y = s.yaw;
      if (s.anim !== a.current) {
        a.actions[a.current]!.crossFadeTo(a.actions[s.anim]!.reset().setEffectiveWeight(1), 0.2, false);
        a.current = s.anim;
      }
      a.mixer.update(dt);
    });
    this.camera.position.set(...cam.position);
    this.camera.lookAt(...cam.target);
  }

  start(hooks: FrameHooks): void {
    const timer = new THREE.Timer();
    this.renderer.setAnimationLoop((t) => {
      hooks.frameStart();
      timer.update(t);
      hooks.update(timer.getDelta());
      this.renderer.render(this.scene, this.camera);
      hooks.frameEnd();
    });
  }

  stats() {
    return { drawCalls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles };
  }

  resize(w: number, h: number): void {
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
}

void runPoc(new ThreeAdapter());
