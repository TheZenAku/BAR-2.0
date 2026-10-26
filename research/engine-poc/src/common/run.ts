// Shared POC runner: options, input, metrics, HUD and benchmark result publication.
import { Simulation, type MoveInput } from './sim';
import type { ColliderFile, EngineAdapter, PocOptions } from './types';

export interface PocResult {
  engine: string;
  version: string;
  avatars: number;
  shadows: boolean;
  userAgent: string;
  renderer: string;
  loadMs: number;
  frames: number;
  fps: number;
  frameMs: { avg: number; p50: number; p95: number; p99: number; max: number };
  cpuMs: { avg: number; p50: number; p95: number; p99: number };
  drawCalls: number;
  triangles: number;
  jsHeapMB: number | null;
  errors: string[];
}

declare global {
  interface Window {
    __pocResult?: PocResult;
    __pocErrors: string[];
  }
}

function readOptions(): PocOptions {
  const q = new URLSearchParams(location.search);
  const num = (k: string, d: number) => (q.has(k) ? Number(q.get(k)) : d);
  return {
    avatars: Math.max(1, Math.min(64, num('n', 16))),
    shadows: q.get('shadows') !== '0',
    bench: q.has('bench'),
    warmupMs: num('warmup', 3000),
    durationMs: num('duration', 10000),
  };
}

const pct = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
const round = (v: number) => Math.round(v * 100) / 100;

function summarize(samples: number[]) {
  const s = [...samples].sort((a, b) => a - b);
  const avg = s.reduce((a, b) => a + b, 0) / Math.max(1, s.length);
  return { avg: round(avg), p50: round(pct(s, 50)), p95: round(pct(s, 95)), p99: round(pct(s, 99)), max: round(s[s.length - 1] ?? 0) };
}

function webglRenderer(canvas: HTMLCanvasElement): string {
  const gl = (canvas.getContext('webgl2') ?? null) as WebGL2RenderingContext | null;
  if (!gl) return 'unknown';
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
}

export async function runPoc(adapter: EngineAdapter): Promise<void> {
  window.__pocErrors = [];
  window.addEventListener('error', (e) => window.__pocErrors.push(String(e.message)));
  window.addEventListener('unhandledrejection', (e) => window.__pocErrors.push(String(e.reason)));

  const opts = readOptions();
  const t0 = performance.now();
  const canvas = document.getElementById('app') as HTMLCanvasElement;
  const hud = document.getElementById('hud')!;
  hud.textContent = `${adapter.engine}: loading…`;

  const colliders = (await (await fetch('assets/bar-colliders.json')).json()) as ColliderFile;
  const [sim] = await Promise.all([Simulation.create(colliders, opts.avatars), adapter.init(canvas, opts)]);
  await adapter.loadScene('assets/bar-greybox.glb');
  await adapter.loadAvatars('assets/avatar.glb', opts.avatars);
  const loadMs = performance.now() - t0;

  // Input: WASD/arrows + mouse drag orbit + wheel zoom. In bench mode a scripted circle walk.
  const keys = new Set<string>();
  addEventListener('keydown', (e) => keys.add(e.code));
  addEventListener('keyup', (e) => keys.delete(e.code));
  let dragging = false;
  canvas.addEventListener('pointerdown', () => (dragging = true));
  addEventListener('pointerup', () => (dragging = false));
  addEventListener('pointermove', (e) => {
    if (!dragging) return;
    sim.camYaw -= e.movementX * 0.005;
    sim.camPitch = Math.min(1.2, Math.max(-0.2, sim.camPitch + e.movementY * 0.005));
  });
  canvas.addEventListener('wheel', (e) => (sim.camDistance = Math.min(8, Math.max(1.5, sim.camDistance + e.deltaY * 0.005))), { passive: true });
  const input: MoveInput = { forward: 0, right: 0 };
  let elapsed = 0;

  const onResize = () => adapter.resize(innerWidth, innerHeight);
  addEventListener('resize', onResize);
  onResize();

  const frameMs: number[] = [];
  const cpuMs: number[] = [];
  let measuring = false;
  let finished = false;
  let lastStart = 0;
  let frameStartT = 0;
  let hudT = 0;
  let hudFrames = 0;
  const benchStart = performance.now();

  adapter.start({
    frameStart() {
      frameStartT = performance.now();
      if (lastStart && measuring) frameMs.push(frameStartT - lastStart);
      lastStart = frameStartT;
    },
    update(dt) {
      elapsed += dt;
      if (opts.bench) {
        input.forward = 1;
        input.right = 0;
        sim.camYaw += dt * 0.6;
      } else {
        input.forward = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
        input.right = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
      }
      sim.step(dt, input);
      adapter.apply(sim.avatars, sim.camera, dt);
    },
    frameEnd() {
      const now = performance.now();
      if (measuring) cpuMs.push(now - frameStartT);
      hudFrames++;
      if (now - hudT > 500) {
        const s = adapter.stats();
        hud.textContent = `${adapter.engine} ${adapter.version} | avatars ${opts.avatars} | ${Math.round((hudFrames * 1000) / (now - hudT))} fps | draw calls ${s.drawCalls} | tris ${s.triangles} | load ${Math.round(loadMs)} ms`;
        hudT = now;
        hudFrames = 0;
      }
      if (!opts.bench || finished) return;
      const t = now - benchStart;
      if (!measuring && t > opts.warmupMs) measuring = true;
      if (measuring && t > opts.warmupMs + opts.durationMs) {
        finished = true;
        const s = adapter.stats();
        const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
        const fs = summarize(frameMs);
        const { max: _max, ...cs } = summarize(cpuMs);
        window.__pocResult = {
          engine: adapter.engine,
          version: adapter.version,
          avatars: opts.avatars,
          shadows: opts.shadows,
          userAgent: navigator.userAgent,
          renderer: webglRenderer(document.createElement('canvas')),
          loadMs: Math.round(loadMs),
          frames: frameMs.length,
          fps: round(1000 / fs.avg),
          frameMs: fs,
          cpuMs: cs,
          drawCalls: s.drawCalls,
          triangles: s.triangles,
          jsHeapMB: mem ? round(mem.usedJSHeapSize / 1048576) : null,
          errors: window.__pocErrors,
        };
      }
    },
  });
}
