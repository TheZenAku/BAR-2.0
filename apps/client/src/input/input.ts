// Keyboard + mouse input. Produces movement axes and accumulated look deltas; knows nothing about the
// camera or the simulation. All listeners hang off one AbortController so `dispose()` removes every one.

export interface MoveAxes {
  forward: number;
  right: number;
  run: boolean;
}

export interface LookDelta {
  dx: number;
  dy: number;
  zoom: number;
}

const FORWARD = ['KeyW', 'ArrowUp'];
const BACK = ['KeyS', 'ArrowDown'];
const LEFT = ['KeyA', 'ArrowLeft'];
const RIGHT = ['KeyD', 'ArrowRight'];
const RUN = ['ShiftLeft', 'ShiftRight'];
const HANDLED = new Set([...FORWARD, ...BACK, ...LEFT, ...RIGHT, ...RUN, 'Space']);

const any = (keys: ReadonlySet<string>, codes: readonly string[]) => codes.some((c) => keys.has(c));

/** Pure mapping from held key codes to movement axes. */
export function axesFromKeys(keys: ReadonlySet<string>): MoveAxes {
  return {
    forward: (any(keys, FORWARD) ? 1 : 0) - (any(keys, BACK) ? 1 : 0),
    right: (any(keys, RIGHT) ? 1 : 0) - (any(keys, LEFT) ? 1 : 0),
    run: any(keys, RUN),
  };
}

/** Minimal DOM surface used, so tests can drive it with plain EventTargets. */
export interface InputHost extends EventTarget {
  readonly document?: { pointerLockElement: Element | null; exitPointerLock?: () => void };
}

export class InputController {
  private readonly keys = new Set<string>();
  private readonly abort = new AbortController();
  private look: LookDelta = { dx: 0, dy: 0, zoom: 0 };
  private dragging = false;
  private readonly surface: EventTarget & { requestPointerLock?: () => unknown };
  private readonly host: InputHost;

  constructor(host: InputHost, surface: EventTarget & { requestPointerLock?: () => unknown }) {
    this.host = host;
    this.surface = surface;
    const opts = { signal: this.abort.signal };
    host.addEventListener('keydown', (e) => this.onKey(e as KeyboardEvent, true), opts);
    host.addEventListener('keyup', (e) => this.onKey(e as KeyboardEvent, false), opts);
    // Losing focus would otherwise leave keys stuck "down".
    host.addEventListener('blur', () => this.keys.clear(), opts);
    host.addEventListener('mousemove', (e) => this.onMouseMove(e as MouseEvent), opts);
    host.addEventListener('mouseup', () => (this.dragging = false), opts);
    surface.addEventListener('mousedown', () => this.onMouseDown(), opts);
    surface.addEventListener('wheel', (e) => this.onWheel(e as WheelEvent), { ...opts, passive: false });
    surface.addEventListener('contextmenu', (e) => e.preventDefault(), opts);
  }

  get axes(): MoveAxes {
    return axesFromKeys(this.keys);
  }

  get pointerLocked(): boolean {
    return this.host.document?.pointerLockElement === (this.surface as unknown as Element);
  }

  /** Returns and resets look input accumulated since the previous call. */
  consumeLook(): LookDelta {
    const l = this.look;
    this.look = { dx: 0, dy: 0, zoom: 0 };
    return l;
  }

  dispose(): void {
    this.abort.abort();
    this.keys.clear();
    if (this.pointerLocked) this.host.document?.exitPointerLock?.();
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    if (!HANDLED.has(e.code)) return;
    e.preventDefault?.(); // arrows/space would scroll the page
    if (down) this.keys.add(e.code);
    else this.keys.delete(e.code);
  }

  private onMouseDown(): void {
    this.dragging = true;
    // Pointer lock can be refused (e.g. headless, iframe policy); dragging still works as a fallback.
    try {
      const r = this.surface.requestPointerLock?.();
      if (r instanceof Promise) r.catch(() => {});
    } catch {
      /* fallback to drag */
    }
  }

  private onMouseMove(e: MouseEvent): void {
    if (!this.pointerLocked && !this.dragging) return;
    this.look.dx += e.movementX ?? 0;
    this.look.dy += e.movementY ?? 0;
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault?.();
    this.look.zoom += Math.sign(e.deltaY);
  }
}
