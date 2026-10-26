// Deep imports (not '@babylonjs/core' root) so the bundle is tree-shaken as Babylon recommends.
import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration';
import { SceneInstrumentation } from '@babylonjs/core/Instrumentation/sceneInstrumentation';
import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader';
import type { AnimationGroup } from '@babylonjs/core/Animations/animationGroup';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import '@babylonjs/core/Animations/animatable';
import '@babylonjs/loaders/glTF';
import { runPoc } from '../common/run';
import type { AvatarState, CameraState, EngineAdapter, FrameHooks, PocOptions } from '../common/types';

interface Avatar {
  root: TransformNode;
  groups: Record<string, AnimationGroup>;
  current: string;
  blend: number; // 0..1 progress of the current cross-fade
}

const FADE = 0.2;

class BabylonAdapter implements EngineAdapter {
  readonly engine = 'babylon';
  readonly version = Engine.Version;
  private engineRef!: Engine;
  private scene!: Scene;
  private camera!: UniversalCamera;
  private shadows: ShadowGenerator | null = null;
  private avatars: Avatar[] = [];
  private instr!: SceneInstrumentation;

  async init(canvas: HTMLCanvasElement, opts: PocOptions): Promise<void> {
    this.engineRef = new Engine(canvas, true, { powerPreference: 'high-performance' }, false);
    this.engineRef.setHardwareScalingLevel(1);
    const scene = (this.scene = new Scene(this.engineRef));
    scene.useRightHandedSystem = true; // glTF convention; avoids the __root__ handedness flip
    scene.clearColor = new Color4(0.102, 0.078, 0.063, 1);
    scene.fogMode = Scene.FOGMODE_EXP2;
    scene.fogDensity = 0.02;
    scene.fogColor = new Color3(0.102, 0.078, 0.063);
    scene.imageProcessingConfiguration.toneMappingEnabled = true;
    scene.imageProcessingConfiguration.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    this.camera = new UniversalCamera('cam', new Vector3(0, 3, 8), scene);
    this.camera.fov = (60 * Math.PI) / 180;
    this.camera.minZ = 0.1;
    this.camera.maxZ = 100;
    const hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene);
    hemi.diffuse = Color3.FromHexString('#8090b0');
    hemi.groundColor = Color3.FromHexString('#302018');
    hemi.intensity = 1.0;
    const sun = new DirectionalLight('sun', new Vector3(5, -10, -4).normalize(), scene);
    sun.position = new Vector3(-5, 10, 4);
    sun.diffuse = Color3.FromHexString('#fff1d6');
    sun.intensity = 2.0;
    sun.shadowMinZ = 0.5;
    sun.shadowMaxZ = 30;
    if (opts.shadows) {
      this.shadows = new ShadowGenerator(2048, sun);
      this.shadows.usePercentageCloserFiltering = true;
      this.shadows.bias = 0.0005;
    }
    for (const [x, z] of [[-6, 0], [4, 0], [-1, 4], [-2, -4.5]] as const) {
      const l = new PointLight(`p${x}${z}`, new Vector3(x, 2.8, z), scene);
      l.diffuse = Color3.FromHexString('#ffb060');
      l.intensity = 6;
      l.range = 8;
    }
    this.instr = new SceneInstrumentation(scene);
    this.instr.captureFrameTime = false;
  }

  async loadScene(url: string): Promise<void> {
    const c = await LoadAssetContainerAsync(url, this.scene);
    c.addAllToScene();
    for (const m of c.meshes) {
      m.receiveShadows = true;
      this.shadows?.addShadowCaster(m, false);
    }
  }

  async loadAvatars(url: string, count: number): Promise<void> {
    const c = await LoadAssetContainerAsync(url, this.scene);
    for (let i = 0; i < count; i++) {
      const inst = c.instantiateModelsToScene((n) => `${n}_${i}`, false, { doNotInstantiate: true });
      const root = inst.rootNodes[0] as TransformNode;
      root.getChildMeshes(false).forEach((m) => {
        this.shadows?.addShadowCaster(m, false);
        m.alwaysSelectAsActiveMesh = true; // skinned bounds are bind-pose only (same as three/playcanvas setup)
      });
      const groups = Object.fromEntries(inst.animationGroups.map((g) => [g.name.replace(`_${i}`, ''), g]));
      for (const g of inst.animationGroups) g.stop();
      groups['Idle']!.start(true).weight = 1;
      groups['Walk']!.start(true).weight = 0;
      this.avatars.push({ root, groups, current: 'Idle', blend: 1 });
    }
  }

  apply(states: readonly AvatarState[], cam: CameraState, dt: number): void {
    states.forEach((s, i) => {
      const a = this.avatars[i]!;
      a.root.position.set(...s.position);
      a.root.rotationQuaternion = null;
      a.root.rotation.set(0, s.yaw, 0);
      if (s.anim !== a.current) {
        a.current = s.anim;
        a.blend = 1 - a.blend;
      }
      a.blend = Math.min(1, a.blend + dt / FADE);
      const other = a.current === 'Idle' ? 'Walk' : 'Idle';
      a.groups[a.current]!.weight = a.blend;
      a.groups[other]!.weight = 1 - a.blend;
    });
    this.camera.position.set(...cam.position);
    this.camera.setTarget(new Vector3(...cam.target));
  }

  start(hooks: FrameHooks): void {
    this.engineRef.runRenderLoop(() => {
      hooks.frameStart();
      hooks.update(this.engineRef.getDeltaTime() / 1000);
      this.scene.render();
      hooks.frameEnd();
    });
  }

  stats() {
    return { drawCalls: this.instr.drawCallsCounter.current, triangles: Math.round(this.scene.getActiveIndices() / 3) };
  }

  resize(w: number, h: number): void {
    const canvas = this.engineRef.getRenderingCanvas()!;
    canvas.width = w;
    canvas.height = h;
    this.engineRef.resize();
  }
}

void AbstractMesh;
void runPoc(new BabylonAdapter());
