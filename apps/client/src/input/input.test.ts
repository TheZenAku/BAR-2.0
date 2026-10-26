import { describe, expect, it } from 'vitest';
import { axesFromKeys, InputController } from './input.ts';

const key = (type: string, code: string) => Object.assign(new Event(type), { code });

describe('axesFromKeys', () => {
  it('combines opposing keys and diagonals', () => {
    expect(axesFromKeys(new Set(['KeyW', 'KeyD']))).toEqual({ forward: 1, right: 1, run: false });
    expect(axesFromKeys(new Set(['KeyW', 'KeyS', 'ArrowLeft', 'ShiftLeft']))).toEqual({
      forward: 0,
      right: -1,
      run: true,
    });
  });
});

describe('InputController', () => {
  it('tracks held keys and clears them on blur', () => {
    const host = new EventTarget();
    const input = new InputController(host, new EventTarget());
    host.dispatchEvent(key('keydown', 'KeyW'));
    host.dispatchEvent(key('keydown', 'ShiftLeft'));
    expect(input.axes).toEqual({ forward: 1, right: 0, run: true });
    host.dispatchEvent(new Event('blur'));
    expect(input.axes).toEqual({ forward: 0, right: 0, run: false });
    input.dispose();
  });

  it('accumulates drag look and wheel zoom, then resets on consume', () => {
    const host = new EventTarget();
    const surface = new EventTarget();
    const input = new InputController(host, surface);
    host.dispatchEvent(Object.assign(new Event('mousemove'), { movementX: 5, movementY: 5 }));
    expect(input.consumeLook()).toEqual({ dx: 0, dy: 0, zoom: 0 }); // not dragging, not locked
    surface.dispatchEvent(new Event('mousedown'));
    host.dispatchEvent(Object.assign(new Event('mousemove'), { movementX: 3, movementY: -2 }));
    surface.dispatchEvent(Object.assign(new Event('wheel'), { deltaY: 120 }));
    expect(input.consumeLook()).toEqual({ dx: 3, dy: -2, zoom: 1 });
    expect(input.consumeLook()).toEqual({ dx: 0, dy: 0, zoom: 0 });
    input.dispose();
  });

  it('removes every listener on dispose', () => {
    const host = new EventTarget();
    const input = new InputController(host, new EventTarget());
    input.dispose();
    host.dispatchEvent(key('keydown', 'KeyW'));
    expect(input.axes.forward).toBe(0);
  });
});
