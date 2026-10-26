import type { PlayerSnapshot } from '@bar/game-core';
import type { RenderInfo } from '../render/render-stage.ts';
import type { FrameSummary } from './frame-stats.ts';

/** Diagnostics exposed by the running game (HUD and E2E). */
export interface DebugSnapshot {
  player: PlayerSnapshot;
  animation: string;
  frame: FrameSummary;
  cpuMs: number;
  simAvgMs: number;
  droppedTicks: number;
  render: RenderInfo;
  heapMB: number | null;
  profile: string;
  cameraDistance: number;
}
