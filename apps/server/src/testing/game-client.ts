// Headless game client for integration and load tests: the real Colyseus SDK over a real WebSocket, authenticated
// with a real session cookie (no mocks). Mirrors what the browser client sends: intent batches, never positions.
import {
  GameCloseCode,
  type InputFrame,
  Msg,
  type Roster,
  SeatReservation,
  type Snapshot,
  type Welcome,
} from '@bar/shared';
import { Client, type Room } from '@colyseus/sdk';
import { call, ORIGIN, type TestContext } from './harness.ts';

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function waitUntil(what: string, fn: () => boolean, timeoutMs = 5000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!fn()) {
    if (Date.now() > end) throw new Error(`timeout waiting for: ${what}`);
    await sleep(10);
  }
}

export function gameBaseUrl(ctx: Pick<TestContext, 'app'>): string {
  const addr = ctx.app.server.address();
  if (addr === null || typeof addr === 'string') throw new Error('app is not listening');
  return `http://127.0.0.1:${addr.port}`;
}

/** Reserves a seat through the HTTP route (cookie + Origin, like a browser). */
export async function reserveSeat(ctx: Pick<TestContext, 'app'>, token: string): Promise<SeatReservation> {
  const res = await call(ctx, 'POST', '/api/v1/game/join', { token });
  if (res.status !== 200) throw Object.assign(new Error(`join ${res.status}: ${res.raw}`), { status: res.status });
  return SeatReservation.parse(res.body);
}

export class TestPlayer {
  readonly room: Room;
  welcome: Welcome | undefined;
  roster: Roster | undefined;
  readonly snapshots: Snapshot[] = [];
  welcomes = 0;
  leftCode: number | undefined;
  dropped = 0;
  reconnected = 0;
  private seq = 0;

  private constructor(room: Room) {
    this.room = room;
    room.onMessage(Msg.welcome, (w: Welcome) => {
      this.welcome = w;
      this.roster = w;
      this.welcomes++;
    });
    room.onMessage(Msg.roster, (r: Roster) => {
      this.roster = r;
    });
    room.onMessage(Msg.snapshot, (s: Snapshot) => {
      this.snapshots.push(s);
    });
    room.onLeave((code) => {
      this.leftCode = code;
    });
    room.onDrop(() => {
      this.dropped++;
    });
    room.onReconnect(() => {
      this.reconnected++;
    });
    room.reconnection.minUptime = 0;
    room.reconnection.minDelay = 50;
  }

  static client(base: string, headers: Record<string, string>): Client {
    return new Client(`${base}/game`, { headers });
  }

  static async join(ctx: Pick<TestContext, 'app'>, token: string, opts: { origin?: string } = {}): Promise<TestPlayer> {
    const seat = await reserveSeat(ctx, token);
    const client = TestPlayer.client(gameBaseUrl(ctx), { cookie: `bar_sid=${token}`, origin: opts.origin ?? ORIGIN });
    const player = new TestPlayer(await client.consumeSeatReservation(seat));
    await waitUntil('welcome', () => player.welcome !== undefined);
    return player;
  }

  get pid(): number {
    return this.welcome!.you;
  }

  get last(): Snapshot | undefined {
    return this.snapshots.at(-1);
  }

  get ended(): boolean {
    return this.leftCode !== undefined;
  }

  /** Raw message: lets tests send anything, including invalid payloads. */
  sendRaw(type: string, payload: unknown): void {
    this.room.send(type, payload);
  }

  /** Next `n` sequential frames of one intent. */
  frames(n: number, forward: number, right = 0, run = false, yaw = 0): InputFrame[] {
    return Array.from({ length: n }, () => [this.seq++, forward, right, run, yaw] as InputFrame);
  }

  /** Paced like the browser: 2 frames every 2 ticks (30 messages/s) for `ticks` simulation ticks. */
  async drive(ticks: number, forward: number, right = 0, run = false, yaw = 0): Promise<void> {
    for (let sent = 0; sent < ticks; sent += 2) {
      this.room.send(Msg.input, this.frames(Math.min(2, ticks - sent), forward, right, run, yaw));
      await sleep(1000 / 30);
    }
  }

  async leave(): Promise<void> {
    if (!this.ended) await this.room.leave();
  }
}

export const isSessionEnd = (code: number | undefined) => code === GameCloseCode.SESSION_ENDED;
