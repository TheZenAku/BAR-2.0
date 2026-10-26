import { MOVEMENT } from './config.ts';

export type Locomotion = 'idle' | 'walk' | 'run';

// Hysteresis bands (m/s) prevent flicker between states around a threshold.
const WALK_ENTER = 0.25;
const WALK_EXIT = 0.12;
const RUN_ENTER = (MOVEMENT.walkSpeed + MOVEMENT.runSpeed) / 2 + 0.2;
const RUN_EXIT = RUN_ENTER - 0.5;

/** Locomotion state from measured horizontal speed (not intent: walking into a wall reads as idle). */
export function nextLocomotion(prev: Locomotion, speed: number): Locomotion {
  if (prev === 'run') return speed >= RUN_EXIT ? 'run' : speed >= WALK_EXIT ? 'walk' : 'idle';
  if (speed >= RUN_ENTER) return 'run';
  if (prev === 'walk') return speed >= WALK_EXIT ? 'walk' : 'idle';
  return speed >= WALK_ENTER ? 'walk' : 'idle';
}
