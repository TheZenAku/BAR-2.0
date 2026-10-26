// Minimal debug overlay (F3 toggles). Text-only, refreshed a few times per second to stay off the hot path.
import type { DebugSnapshot } from './debug-snapshot.ts';

const REFRESH_MS = 250;
const f1 = (n: number) => n.toFixed(1);

export function formatSnapshot(s: DebugSnapshot): string {
  const p = s.player.position;
  const mem = s.heapMB === null ? 'n/d' : `${f1(s.heapMB)} MB`;
  return [
    `FPS ${f1(s.frame.fps)}  ·  frame p50 ${f1(s.frame.p50Ms)} / p95 ${f1(s.frame.p95Ms)} / p99 ${f1(s.frame.p99Ms)} ms`,
    `CPU frame ${f1(s.cpuMs)} ms  ·  sim ${s.simAvgMs.toFixed(3)} ms/tick  ·  ticks perdidos ${s.droppedTicks}`,
    `draw calls ${s.render.drawCalls}  ·  triângulos ${s.render.triangles}  ·  geo ${s.render.geometries}  ·  tex ${s.render.textures}  ·  shaders ${s.render.programs}`,
    `heap JS ${mem}  ·  perfil ${s.profile}`,
    `pos ${f1(p.x)} ${p.y.toFixed(2)} ${f1(p.z)}  ·  ${s.player.speed.toFixed(2)} m/s  ·  ${s.player.locomotion}${s.player.grounded ? '' : ' (no ar)'}  ·  anim ${s.animation}`,
    'WASD/setas mover · Shift correr · clique: capturar mouse (Esc solta) · roda: zoom · F3: HUD',
  ].join('\n');
}

export class DebugHud {
  private readonly el: HTMLPreElement;
  private readonly abort = new AbortController();
  private last = 0;

  constructor(parent: HTMLElement, visible: boolean) {
    this.el = document.createElement('pre');
    this.el.id = 'debug-hud';
    this.el.setAttribute('aria-live', 'off');
    this.el.style.cssText =
      'position:fixed;top:8px;left:8px;margin:0;padding:8px 10px;background:rgba(0,0,0,.6);color:#f3e9dc;' +
      'font:12px/1.45 ui-monospace,Consolas,monospace;border-radius:6px;pointer-events:none;white-space:pre';
    this.el.hidden = !visible;
    parent.append(this.el);
    window.addEventListener(
      'keydown',
      (e) => {
        if (e.code !== 'F3') return;
        e.preventDefault();
        this.el.hidden = !this.el.hidden;
      },
      { signal: this.abort.signal },
    );
  }

  update(now: number, snapshot: () => DebugSnapshot): void {
    if (this.el.hidden || now - this.last < REFRESH_MS) return;
    this.last = now;
    this.el.textContent = formatSnapshot(snapshot());
  }

  dispose(): void {
    this.abort.abort();
    this.el.remove();
  }
}
