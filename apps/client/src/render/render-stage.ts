// WebGL renderer, scene, camera and lighting. Knows the graphics profile; knows nothing about gameplay.
import {
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  PCFShadowMap,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from 'three';
import type { GraphicsProfile } from './graphics-profile.ts';
import { pixelRatioFor } from './graphics-profile.ts';

export interface RenderInfo {
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  programs: number;
}

export class RenderStage {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(60, 1, 0.1, 80);
  readonly profile: GraphicsProfile;
  private readonly sun: DirectionalLight;
  private readonly abort = new AbortController();

  constructor(canvas: HTMLCanvasElement, profile: GraphicsProfile) {
    this.profile = profile;
    this.renderer = new WebGLRenderer({ canvas, antialias: profile.antialias, powerPreference: 'high-performance' });
    this.renderer.shadowMap.enabled = profile.shadows;
    this.renderer.shadowMap.type = PCFShadowMap;

    this.scene.background = new Color(0x1a1410);
    this.scene.fog = new Fog(0x1a1410, 18, 40);
    this.scene.add(new HemisphereLight(0xffe8cc, 0x2a2018, 1.4));
    this.sun = new DirectionalLight(0xfff1dd, 2.2);
    this.sun.position.set(6, 12, 5);
    if (profile.shadows) {
      this.sun.castShadow = true;
      this.sun.shadow.mapSize.set(profile.shadowMapSize, profile.shadowMapSize);
      const c = this.sun.shadow.camera;
      // Covers the whole 20 × 14 m greybox; revisit when the real bar arrives (M6).
      Object.assign(c, { left: -13, right: 13, top: 13, bottom: -13, near: 1, far: 30 });
      c.updateProjectionMatrix();
      this.sun.shadow.bias = -0.0005;
      this.sun.shadow.normalBias = 0.02;
    }
    this.scene.add(this.sun);

    window.addEventListener('resize', () => this.resize(), { signal: this.abort.signal });
    this.resize();
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setPixelRatio(pixelRatioFor(this.profile, window.devicePixelRatio));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(h, 1);
    this.camera.updateProjectionMatrix();
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  info(): RenderInfo {
    const { render, memory, programs } = this.renderer.info;
    return {
      drawCalls: render.calls,
      triangles: render.triangles,
      geometries: memory.geometries,
      textures: memory.textures,
      programs: programs?.length ?? 0,
    };
  }

  /**
   * Destroys the renderer. Returns GPU geometries/textures still registered right before that — anything
   * above zero means some owner forgot to dispose (checked by the E2E smoke test).
   */
  dispose(): { geometries: number; textures: number } {
    this.abort.abort();
    this.sun.shadow.dispose();
    const { geometries, textures } = this.renderer.info.memory;
    this.renderer.dispose();
    return { geometries, textures };
  }
}
