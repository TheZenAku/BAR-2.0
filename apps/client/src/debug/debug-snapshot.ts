import type { PlayerSnapshot } from '@bar/game-core';
import type { RemoteInfo } from '../game/remote-players.ts';
import type { NetStats } from '../net/game-connection.ts';
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
  /** Multiplayer (M3); null when the scene runs without a connection. */
  net: NetDebug | null;
}

export interface NetDebug extends NetStats {
  you: number | null;
  players: number;
  maxPlayers: number;
  pendingInputs: number;
  corrections: number;
  lastCorrectionCm: number;
  interpDelayMs: number;
  remotes: RemoteInfo[];
}
