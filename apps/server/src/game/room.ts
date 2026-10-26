// The single shared room. Colyseus owns sockets, seat reservations and reconnection tokens; this class owns identity,
// authority and session lifetime. Clients send intents only; the server simulates and sends snapshots.
import { FixedStepper, type LevelDef, type RapierApi, SIM_DT } from '@bar/game-core';
import {
  GameCloseCode,
  InputBatch,
  Msg,
  OpaqueToken,
  type Roster,
  SNAPSHOT_EVERY_TICKS,
  type Welcome,
} from '@bar/shared';
import { type AuthContext, type Client, ErrorCode, Room, ServerError } from '@colyseus/core';
import type { AuthService, Revocation } from '../auth/service.ts';
import { hashToken } from '../auth/tokens.ts';
import type { Logger } from '../logger.ts';
import { GameWorld, type PlayerIdentity, type WorldPlayer } from './world.ts';

export interface GameDeps {
  auth: AuthService;
  rapier: RapierApi;
  level: LevelDef;
  logger: Logger;
  cookieName: string;
  maxPlayers: number;
  /** Seconds a dropped player keeps their place while the client reconnects. */
  reconnectSeconds: number;
  /** Interval of the batch check that ends connections whose session expired. */
  revalidateMs: number;
}

/** Seat handed out by the join route; consumed by the WebSocket handshake of the same account. */
interface Seat {
  identity: PlayerIdentity;
  tokenHash: Buffer;
  expiresAt: number;
}

interface Member {
  client: Client;
  player: WorldPlayer;
  tokenHash: Buffer;
  invalidMessages: number;
  /** Set when the server ends the connection on purpose: no reconnection is reserved. */
  kicked: boolean;
}

const SEAT_TTL_MS = 15_000;
/** Malformed (but decodable) messages tolerated per connection before it is closed. */
const MAX_INVALID_MESSAGES = 20;

/** Session token from a raw Cookie header; undefined unless it is well-formed. */
export function readSessionCookie(header: string | null | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) {
      const value = part.slice(eq + 1).trim();
      return OpaqueToken.safeParse(value).success ? value : undefined;
    }
  }
  return undefined;
}

export class BarRoom extends Room {
  private readonly deps: GameDeps;
  private world!: GameWorld;
  private readonly seats = new Map<string, Seat>();
  /** By Colyseus sessionId (stable across reconnections of the same seat). */
  private readonly members = new Map<string, Member>();
  private readonly stepper = new FixedStepper(SIM_DT, 10);
  private stopRevocations: (() => void) | undefined;
  private revalidating = false;
  private lastAdvance = performance.now();
  private readonly tickCost = { totalMs: 0, ticks: 0, maxMs: 0 };

  constructor(deps: GameDeps) {
    super();
    this.deps = deps;
  }

  override onCreate(): void {
    const { deps } = this;
    this.maxClients = deps.maxPlayers;
    this.autoDispose = false;
    this.patchRate = null; // no shared Schema state: snapshots are per-client messages (each carries its own ack)
    this.maxMessagesPerSecond = 120;
    this.seatReservationTimeout = SEAT_TTL_MS / 1000;
    this.world = new GameWorld(deps.rapier, deps.level);
    this.onMessage(Msg.input, (client, payload) => this.handleInput(client, payload));
    this.onMessage('*', (client) => this.invalidMessage(client));
    // Only the timer is borrowed: the room clock's deltaTime is shared with Colyseus' own timers (it read ~1 ms per
    // call), so elapsed time is measured here and the FixedStepper turns it into exact 60 Hz ticks.
    this.setSimulationInterval(() => this.advance(), 1000 / 60);
    this.clock.setInterval(() => void this.revalidateSessions(), deps.revalidateMs);
    this.stopRevocations = deps.auth.onRevocation((r) => this.revoke(r));
  }

  // --- seats and identity ----------------------------------------------------------------------------------------

  /** Called by the join route right after Colyseus reserved `sessionId`. */
  bindSeat(sessionId: string, identity: PlayerIdentity, tokenHash: Buffer): void {
    const now = Date.now();
    for (const [id, seat] of this.seats) if (seat.expiresAt < now) this.seats.delete(id);
    this.seats.set(sessionId, { identity, tokenHash, expiresAt: now + SEAT_TTL_MS });
  }

  /** Account that owns a connected or reconnecting member (reconnection handshakes must match it). */
  memberUserId(sessionId: string): string | undefined {
    return this.members.get(sessionId)?.player.identity.userId;
  }

  get playerCount(): number {
    return this.world.size;
  }

  /** Server-side diagnostics (tests and load measurements). */
  stats() {
    const { totalMs, ticks, maxMs } = this.tickCost;
    return {
      players: this.world.size,
      tick: this.world.tick,
      avgTickMs: ticks ? totalMs / ticks : 0,
      maxTickMs: maxMs,
    };
  }

  resetStats(): void {
    Object.assign(this.tickCost, { totalMs: 0, ticks: 0, maxMs: 0 });
  }

  /** Test hook: the authoritative player of an account. */
  playerOf(publicId: string): WorldPlayer | undefined {
    for (const m of this.members.values()) if (m.player.identity.publicId === publicId) return m.player;
    return undefined;
  }

  /** The WebSocket handshake must carry a live session of the same account the seat was reserved for. */
  override async onAuth(client: Client, _options: unknown, context: AuthContext): Promise<Seat> {
    const seat = this.seats.get(client.sessionId);
    const token = readSessionCookie(context.headers.get('cookie'), this.deps.cookieName);
    const session = token === undefined ? undefined : await this.deps.auth.authenticate(token);
    if (!seat || seat.expiresAt < Date.now() || !session || session.userId !== seat.identity.userId) {
      this.seats.delete(client.sessionId);
      throw new ServerError(ErrorCode.AUTH_FAILED, 'not authorized');
    }
    this.seats.delete(client.sessionId);
    // The cookie may have rotated between reservation and handshake: track the session actually used.
    return { ...seat, tokenHash: hashToken(token!) };
  }

  override onJoin(client: Client): void {
    const seat = client.auth as Seat;
    // One presence per account: a new tab/device replaces the previous connection.
    for (const [sessionId, m] of this.members) {
      if (m.player.identity.userId === seat.identity.userId) this.kick(sessionId, GameCloseCode.REPLACED);
    }
    const player = this.world.add(seat.identity);
    this.members.set(client.sessionId, {
      client,
      player,
      tokenHash: seat.tokenHash,
      invalidMessages: 0,
      kicked: false,
    });
    this.deps.logger.info({ player: seat.identity.publicId, pid: player.pid, players: this.world.size }, 'game join');
    client.send(Msg.welcome, this.welcome(player));
    this.broadcastRoster();
  }

  override async onDrop(client: Client, code?: number): Promise<void> {
    const member = this.members.get(client.sessionId);
    if (!member || member.kicked) return; // onLeave follows and cleans up
    this.deps.logger.info({ player: member.player.identity.publicId, code }, 'game connection dropped');
    // The player stays in the world (idle once inputs stop) while the client reconnects with its token.
    this.allowReconnection(client, this.deps.reconnectSeconds);
  }

  override onReconnect(client: Client): void {
    const member = this.members.get(client.sessionId);
    if (!member || member.kicked) throw new Error('reconnection refused');
    member.client = client;
    this.deps.logger.info({ player: member.player.identity.publicId }, 'game reconnected');
    client.send(Msg.welcome, this.welcome(member.player));
  }

  override onLeave(client: Client, code?: number): void {
    const member = this.members.get(client.sessionId);
    if (!member) return;
    this.removeMember(client.sessionId, member);
    this.deps.logger.info({ player: member.player.identity.publicId, code }, 'game leave');
  }

  override onDispose(): void {
    this.stopRevocations?.();
    this.world.dispose();
  }

  // --- simulation ------------------------------------------------------------------------------------------------

  private advance(): void {
    const now = performance.now();
    const elapsed = (now - this.lastAdvance) / 1000;
    this.lastAdvance = now;
    this.stepper.advance(elapsed, () => {
      const t0 = performance.now();
      this.world.step();
      if (this.world.tick % SNAPSHOT_EVERY_TICKS === 0) this.sendSnapshots();
      const ms = performance.now() - t0;
      this.tickCost.totalMs += ms;
      this.tickCost.ticks++;
      this.tickCost.maxMs = Math.max(this.tickCost.maxMs, ms);
    });
  }

  private sendSnapshots(): void {
    if (this.members.size === 0) return;
    const all = this.world.remoteStates();
    for (const m of this.members.values()) {
      if (!m.kicked) m.client.send(Msg.snapshot, this.world.snapshotFor(m.player, all));
    }
  }

  private handleInput(client: Client, payload: unknown): void {
    const member = this.members.get(client.sessionId);
    if (!member || member.kicked) return;
    const parsed = InputBatch.safeParse(payload);
    if (!parsed.success) {
      this.invalidMessage(client);
      return;
    }
    member.player.enqueue(parsed.data);
  }

  private invalidMessage(client: Client): void {
    const member = this.members.get(client.sessionId);
    if (!member) return;
    if (++member.invalidMessages > MAX_INVALID_MESSAGES) {
      this.deps.logger.warn({ player: member.player.identity.publicId }, 'game protocol violation');
      this.kick(client.sessionId, GameCloseCode.PROTOCOL_VIOLATION);
    }
  }

  // --- session lifetime ------------------------------------------------------------------------------------------

  private revoke(r: Revocation): void {
    for (const [sessionId, m] of this.members) {
      const hit = r.kind === 'session' ? m.tokenHash.equals(r.tokenHash) : m.player.identity.userId === r.userId;
      if (hit) this.kick(sessionId, GameCloseCode.SESSION_ENDED);
    }
    for (const [sessionId, seat] of this.seats) {
      const hit = r.kind === 'session' ? seat.tokenHash.equals(r.tokenHash) : seat.identity.userId === r.userId;
      if (hit) this.seats.delete(sessionId);
    }
  }

  /** Expired sessions produce no event: one query checks every connected session. */
  private async revalidateSessions(): Promise<void> {
    if (this.revalidating || this.members.size === 0) return;
    this.revalidating = true;
    try {
      const entries = [...this.members.entries()];
      const alive = await this.deps.auth.activeSessions(entries.map(([, m]) => m.tokenHash));
      for (const [sessionId, m] of entries) {
        if (!alive.has(m.tokenHash.toString('hex'))) this.kick(sessionId, GameCloseCode.SESSION_ENDED);
      }
    } catch (err) {
      this.deps.logger.warn({ err: { message: (err as Error).message } }, 'session revalidation failed');
    } finally {
      this.revalidating = false;
    }
  }

  private kick(sessionId: string, code: number): void {
    const member = this.members.get(sessionId);
    if (!member || member.kicked) return;
    member.kicked = true;
    this.removeMember(sessionId, member);
    member.client.leave(code);
    this.deps.logger.info({ player: member.player.identity.publicId, code }, 'game connection closed by server');
  }

  private removeMember(sessionId: string, member: Member): void {
    if (this.members.get(sessionId) !== member) return;
    this.members.delete(sessionId);
    this.world.remove(member.player.pid);
    this.broadcastRoster();
  }

  private roster(): Roster {
    return { players: this.world.roster(), max: this.maxClients };
  }

  private welcome(player: WorldPlayer): Welcome {
    return { ...this.roster(), you: player.pid, tick: this.world.tick };
  }

  private broadcastRoster(): void {
    const roster = this.roster();
    for (const m of this.members.values()) if (!m.kicked) m.client.send(Msg.roster, roster);
  }
}
