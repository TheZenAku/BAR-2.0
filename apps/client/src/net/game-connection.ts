// Connection to the shared room. The seat comes from POST /api/v1/game/join (session cookie, same origin); the
// WebSocket handshake carries the same HttpOnly cookie, so no token ever appears in URLs or JavaScript.
// Network drops reconnect automatically (Colyseus reconnection token); a session ended by the server does not.
import {
  API_PREFIX,
  GAME_WS_PATH,
  GameCloseCode,
  type InputFrame,
  MAX_INPUTS_PER_MESSAGE,
  Msg,
  Roster,
  SeatReservation,
  type Snapshot,
  Welcome,
} from '@bar/shared';
import { Client, type Room } from '@colyseus/sdk';

export type NetStatus = 'connecting' | 'online' | 'reconnecting' | 'offline' | 'replaced' | 'session-ended';

export interface NetHandlers {
  welcome(w: Welcome): void;
  roster(r: Roster): void;
  snapshot(s: Snapshot, receivedAtMs: number): void;
  status(s: NetStatus): void;
}

/** Full rejoins (new seat) after the automatic reconnection gave up. */
const REJOIN_DELAYS_MS = [1000, 2000, 4000, 8000];
const PING_EVERY_MS = 2000;

export interface NetStats {
  status: NetStatus;
  rttMs: number | null;
  snapshotsPerSec: number;
  reconnections: number;
}

export class GameConnection {
  private readonly handlers: NetHandlers;
  private room: Room | undefined;
  private state: NetStatus = 'connecting';
  private disposed = false;
  private rejoinAttempt = 0;
  private pingTimer: ReturnType<typeof setInterval> | undefined;
  private rttMs: number | null = null;
  private snapshotTimes: number[] = [];
  private reconnections = 0;

  constructor(handlers: NetHandlers) {
    this.handlers = handlers;
    void this.join();
  }

  get status(): NetStatus {
    return this.state;
  }

  stats(now = performance.now()): NetStats {
    this.snapshotTimes = this.snapshotTimes.filter((t) => now - t < 1000);
    return {
      status: this.state,
      rttMs: this.rttMs,
      snapshotsPerSec: this.snapshotTimes.length,
      reconnections: this.reconnections,
    };
  }

  /** Sends input frames (batched by the caller; split to the protocol limit here). */
  send(frames: readonly InputFrame[]): void {
    if (!this.room || this.state !== 'online') return; // during reconnection the server state wins anyway
    for (let i = 0; i < frames.length; i += MAX_INPUTS_PER_MESSAGE) {
      this.room.send(Msg.input, frames.slice(i, i + MAX_INPUTS_PER_MESSAGE));
    }
  }

  /** Test/diagnostic hook: closes the socket as a network drop would, exercising automatic reconnection. */
  simulateDrop(): void {
    const ws = (this.room?.connection.transport as { ws?: WebSocket } | undefined)?.ws;
    ws?.close(4010, 'simulated drop'); // CloseCode.MAY_TRY_RECONNECT
  }

  /** Leaves the room on purpose (logout, scene teardown): the server removes the player at once. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    clearInterval(this.pingTimer);
    const room = this.room;
    this.room = undefined;
    void room?.leave(true).catch(() => {});
  }

  private setStatus(s: NetStatus): void {
    if (this.state === s) return;
    this.state = s;
    this.handlers.status(s);
  }

  private async join(): Promise<void> {
    this.setStatus(this.rejoinAttempt === 0 ? 'connecting' : 'reconnecting');
    let seat: SeatReservation;
    try {
      const res = await fetch(`${API_PREFIX}/game/join`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: '{}',
      });
      if (res.status === 401) {
        this.setStatus('session-ended');
        return;
      }
      if (!res.ok) throw new Error(`join ${res.status}`);
      seat = SeatReservation.parse(await res.json());
    } catch {
      return this.scheduleRejoin();
    }
    if (this.disposed) return;
    try {
      const client = new Client(`${location.origin}${GAME_WS_PATH}`);
      const room = await client.consumeSeatReservation(seat);
      if (this.disposed) {
        void room.leave(true);
        return;
      }
      this.attach(room);
    } catch {
      this.scheduleRejoin();
    }
  }

  private attach(room: Room): void {
    this.room = room;
    this.rejoinAttempt = 0;
    room.reconnection.minUptime = 1000;
    room.reconnection.maxRetries = 8;
    room.onMessage(Msg.welcome, (w: unknown) => {
      this.setStatus('online');
      this.handlers.welcome(Welcome.parse(w));
    });
    room.onMessage(Msg.roster, (r: unknown) => this.handlers.roster(Roster.parse(r)));
    room.onMessage(Msg.snapshot, (s: Snapshot) => {
      const now = performance.now();
      this.snapshotTimes.push(now);
      this.handlers.snapshot(s, now);
    });
    room.onDrop(() => this.setStatus('reconnecting'));
    room.onReconnect(() => {
      this.reconnections++;
      this.setStatus('online');
    });
    room.onLeave((code) => {
      if (this.room !== room) return;
      this.room = undefined;
      clearInterval(this.pingTimer);
      if (this.disposed) return;
      if (code === GameCloseCode.SESSION_ENDED) this.setStatus('session-ended');
      else if (code === GameCloseCode.REPLACED) this.setStatus('replaced');
      else this.scheduleRejoin();
    });
    clearInterval(this.pingTimer);
    this.pingTimer = setInterval(() => {
      room.ping((ms) => {
        this.rttMs = ms;
      });
    }, PING_EVERY_MS);
  }

  private scheduleRejoin(): void {
    if (this.disposed) return;
    const delay = REJOIN_DELAYS_MS[this.rejoinAttempt];
    if (delay === undefined) {
      this.setStatus('offline');
      return;
    }
    this.rejoinAttempt++;
    this.setStatus('reconnecting');
    setTimeout(() => void this.join(), delay);
  }
}
