import * as pc from 'playcanvas';
import { runPoc } from '../common/run';
import type { AvatarState, CameraState, EngineAdapter, FrameHooks, PocOptions } from '../common/types';

interface Avatar {
  entity: pc.Entity;
  current: string;
}

class PlayCanvasAdapter implements EngineAdapter {
  readonly engine = 'playcanvas';
  readonly version = pc.version;
  private app!: pc.AppBase;
  private camera!: pc.Entity;
  private avatars: Avatar[] = [];
  private shadows = true;

  async init(canvas: HTMLCanvasElement, opts: PocOptions): Promise<void> {
    this.shadows = opts.shadows;
    const device = await pc.createGraphicsDevice(canvas, { deviceTypes: [pc.DEVICETYPE_WEBGL2], antialias: true, powerPreference: 'high-performance' });
    device.maxPixelRatio = 1;
    const options = new pc.AppOptions();
    options.graphicsDevice = device;
    options.componentSystems = [pc.RenderComponentSystem, pc.CameraComponentSystem, pc.LightComponentSystem, pc.AnimComponentSystem];
    options.resourceHandlers = [pc.ContainerHandler, pc.AnimClipHandler, pc.AnimStateGraphHandler];
    const app = (this.app = new pc.AppBase(canvas));
    app.init(options);
    app.setCanvasFillMode(pc.FILLMODE_NONE);
    app.setCanvasResolution(pc.RESOLUTION_AUTO);
    const s = app.scene;
    s.fog.type = pc.FOG_EXP2;
    s.fog.density = 0.02;
    s.fog.color = new pc.Color(0.102, 0.078, 0.063);
    s.ambientLight = new pc.Color(0.2, 0.18, 0.2);

    this.camera = new pc.Entity('camera');
    this.camera.addComponent('camera', { clearColor: new pc.Color(0.102, 0.078, 0.063), fov: 60, nearClip: 0.1, farClip: 100, toneMapping: pc.TONEMAP_ACES, gammaCorrection: pc.GAMMA_SRGB });
    app.root.addChild(this.camera);
    const sun = new pc.Entity('sun');
    sun.addComponent('light', {
      type: 'directional', color: new pc.Color(1, 0.945, 0.84), intensity: 1.2,
      castShadows: opts.shadows, shadowResolution: 2048, shadowDistance: 30, shadowType: pc.SHADOW_PCF3_32F, shadowBias: 0.2, normalOffsetBias: 0.05,
    });
    sun.lookAt(new pc.Vec3(5, -10, -4));
    app.root.addChild(sun);
    for (const [x, z] of [[-6, 0], [4, 0], [-1, 4], [-2, -4.5]] as const) {
      const l = new pc.Entity('point');
      l.addComponent('light', { type: 'omni', color: new pc.Color(1, 0.69, 0.38), intensity: 1.0, range: 8, castShadows: false });
      l.setPosition(x, 2.8, z);
      app.root.addChild(l);
    }
  }

  private loadContainer(url: string): Promise<pc.ContainerResource> {
    return new Promise((resolve, reject) => {
      this.app.assets.loadFromUrl(url, 'container', (err, asset) => (err || !asset ? reject(err) : resolve(asset.resource as pc.ContainerResource)));
    });
  }

  async loadScene(url: string): Promise<void> {
    const res = await this.loadContainer(url);
    const e = res.instantiateRenderEntity({ castShadows: this.shadows, receiveShadows: true });
    this.app.root.addChild(e);
  }

  async loadAvatars(url: string, count: number): Promise<void> {
    const res = await this.loadContainer(url);
    for (let i = 0; i < count; i++) {
      const entity = res.instantiateRenderEntity({ castShadows: this.shadows, receiveShadows: true });
      entity.addComponent('anim', { activate: true });
      for (const a of res.animations) {
        const track = a.resource as pc.AnimTrack;
        entity.anim!.assignAnimation(track.name, track);
      }
      for (const r of entity.findComponents('render') as pc.RenderComponent[]) r.customAabb = new pc.BoundingBox(new pc.Vec3(0, 1, 0), new pc.Vec3(1, 1, 1));
      entity.anim!.baseLayer!.transition('Idle', 0);
      this.app.root.addChild(entity);
      this.avatars.push({ entity, current: 'Idle' });
    }
  }

  apply(states: readonly AvatarState[], cam: CameraState): void {
    states.forEach((s, i) => {
      const a = this.avatars[i]!;
      a.entity.setPosition(...s.position);
      a.entity.setEulerAngles(0, (s.yaw * 180) / Math.PI, 0);
      if (s.anim !== a.current) {
        a.entity.anim!.baseLayer!.transition(s.anim, 0.2);
        a.current = s.anim;
      }
    });
    this.camera.setPosition(...cam.position);
    this.camera.lookAt(...cam.target);
  }

  start(hooks: FrameHooks): void {
    this.app.on('frameupdate', () => hooks.frameStart());
    this.app.on('update', (dt: number) => hooks.update(dt));
    this.app.on('frameend', () => hooks.frameEnd());
    this.app.start();
  }

  stats() {
    const st = this.app.stats;
    // Triangle/primitive counts are only collected by the profiler build; reported as -1 (n/d).
    return { drawCalls: st.drawCalls.total, triangles: -1 };
  }

  resize(w: number, h: number): void {
    this.app.resizeCanvas(w, h);
  }
}

void runPoc(new PlayCanvasAdapter());
