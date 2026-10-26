import { z } from 'zod';
import { PublicId } from './auth.ts';

// Multiplayer wire contract (M3). Transport: Colyseus 0.18 rooms over WebSocket (ADR-0005). The client only ever
// sends intents; positions flow server → client. Messages are msgpack-encoded by Colyseus; arrays keep them small.

/** Name of the single shared room type. */
export const GAME_ROOM = 'bar';
/** URL prefix of the game WebSocket (the Vite dev/preview proxy forwards it to the server). */
export const GAME_WS_PATH = '/game';
/** Snapshots go out every N simulation ticks (60 Hz / 3 = 20 Hz). */
export const SNAPSHOT_EVERY_TICKS = 3;
/** Most inputs one message may carry (the client batches every 2 ticks; extra room absorbs frame hitches). */
export const MAX_INPUTS_PER_MESSAGE = 8;

/** Application close codes (4000–4999). Any of these ends the session on the client: no automatic reconnection. */
export const GameCloseCode = {
  /** Session logged out, expired, or revoked by a password reset / account deletion. */
  SESSION_ENDED: 4401,
  /** The same account joined from another tab or device. */
  REPLACED: 4409,
  /** Too many malformed messages. */
  PROTOCOL_VIOLATION: 4400,
} as const;

/** Message type names (short: they travel with every message). */
export const Msg = {
  /** client → server: InputBatch */
  input: 'i',
  /** server → client: Welcome, sent on join and after a reconnection */
  welcome: 'w',
  /** server → client: Roster, whenever someone joins or leaves */
  roster: 'r',
  /** server → client: Snapshot (20 Hz) */
  snapshot: 's',
} as const;

const axis = z.number().min(-1).max(1);
/** [seq, forward, right, run, cameraYaw]. seq increases by 1 per client tick. */
export const InputFrame = z.tuple([
  z
    .number()
    .int()
    .min(0)
    .max(2 ** 31 - 1),
  axis,
  axis,
  z.boolean(),
  z.number().min(-1000).max(1000),
]);
export type InputFrame = z.infer<typeof InputFrame>;

export const InputBatch = z.array(InputFrame).min(1).max(MAX_INPUTS_PER_MESSAGE);
export type InputBatch = z.infer<typeof InputBatch>;

export const LOCOMOTION_CODES = ['idle', 'walk', 'run'] as const;

export const RosterEntry = z.object({
  /** Room-local numeric id used in snapshots. */
  pid: z.number().int().min(0),
  /** Stable account identity (public id). */
  id: PublicId,
  name: z.string(),
});
export type RosterEntry = z.infer<typeof RosterEntry>;

export const Roster = z.object({ players: z.array(RosterEntry), max: z.number().int() });
export type Roster = z.infer<typeof Roster>;

export const Welcome = Roster.extend({ you: z.number().int().min(0), tick: z.number().int().min(0) });
export type Welcome = z.infer<typeof Welcome>;

/** Own authoritative state: [x, y, z, yaw, vx, vz, verticalSpeed, grounded (0|1), locomotion code]. */
export type SelfState = [number, number, number, number, number, number, number, number, number];
/** Other players: [pid, x, y, z, yaw, speed, locomotion code]. */
export type RemoteState = [number, number, number, number, number, number, number];

export interface Snapshot {
  /** Server tick of this state. */
  t: number;
  /** Last input seq applied to the receiving player (-1 before the first). */
  a: number;
  me: SelfState;
  p: RemoteState[];
}

/** Response of `POST /api/v1/game/join`: a short-lived, single-use seat consumed by the WebSocket handshake. */
export const SeatReservation = z.object({
  name: z.string(),
  roomId: z.string(),
  processId: z.string(),
  sessionId: z.string(),
});
export type SeatReservation = z.infer<typeof SeatReservation>;
