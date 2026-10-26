// Wires Colyseus into the Fastify HTTP server: one process, one port. Only the WebSocket transport is used; Colyseus'
// own HTTP matchmaking routes are never mounted, so every HTTP request still goes through Fastify (Origin guard,
// session cookie, rate limits). Seats are reserved by POST /api/v1/game/join (app.ts).
import type { Server as HttpServer } from 'node:http';
import { GAME_ROOM, GAME_WS_PATH, type SeatReservation } from '@bar/shared';
import { matchMaker } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import type { AuthenticatedUser } from '../auth/service.ts';
import { ApiError } from '../http/errors.ts';
import { BarRoom, type GameDeps, readSessionCookie } from './room.ts';

export interface GameServer {
  /** Reserves a seat for an authenticated account; throws ApiError 409 `room_full`. */
  reserveSeat(session: AuthenticatedUser, tokenHash: Buffer): Promise<SeatReservation>;
  room(): BarRoom;
  close(): Promise<void>;
}

/** Inbound game frames are small intent batches; anything larger is rejected by `ws` before decoding. */
const MAX_PAYLOAD_BYTES = 1024;

export async function attachGame(
  server: HttpServer,
  deps: GameDeps,
  allowedOrigins: ReadonlySet<string>,
): Promise<GameServer> {
  await matchMaker.setup();
  matchMaker.defineRoomType(
    GAME_ROOM,
    class extends BarRoom {
      constructor() {
        super(deps);
      }
    },
  );
  await matchMaker.accept(true); // single process: no IPC, no cross-process health checks (ADR-0005)
  const { roomId } = await matchMaker.createRoom(GAME_ROOM, {});
  const room = (): BarRoom => {
    const r = matchMaker.getLocalRoomById(roomId);
    if (!(r instanceof BarRoom)) throw new Error('game room is gone');
    return r;
  };

  const transport = new WebSocketTransport({
    noServer: true,
    maxPayload: MAX_PAYLOAD_BYTES,
    pingInterval: 3000,
    pingMaxRetries: 2,
    // Runs before the HTTP 101: cross-site pages and handshakes without a session never get a socket.
    beforeUpgrade: async (request) => {
      const origin = request.headers.get('origin');
      if (origin === null || !allowedOrigins.has(origin)) return new Response(null, { status: 403 });
      const token = readSessionCookie(request.headers.get('cookie'), deps.cookieName);
      if (token === undefined) return new Response(null, { status: 401 });
      const url = new URL(request.url);
      // Reconnections skip onAuth in Colyseus: authenticate here and require the account that owns the seat.
      if (url.searchParams.has('reconnectionToken')) {
        const session = await deps.auth.authenticate(token);
        const sessionId = url.searchParams.get('sessionId') ?? '';
        if (!session || room().memberUserId(sessionId) !== session.userId) return new Response(null, { status: 401 });
      }
      return undefined;
    },
  });
  const isGamePath = (url: string | undefined) => url?.startsWith(`${GAME_WS_PATH}/`) === true;
  transport.attachToServer(server, { filter: (req) => isGamePath(req.url) });
  // Nothing else in this server speaks WebSocket: refuse other upgrade requests instead of leaving them hanging.
  server.on('upgrade', (req, socket) => {
    if (!isGamePath(req.url)) socket.destroy();
  });

  return {
    room,
    async reserveSeat(session, tokenHash) {
      const r = room();
      if (r.playerCount >= deps.maxPlayers) throw new ApiError(409, 'room_full', 'The room is full');
      let reservation: Awaited<ReturnType<typeof matchMaker.joinById>>;
      try {
        reservation = await matchMaker.joinById(roomId, {});
      } catch {
        // Locked: every seat is taken or reserved.
        throw new ApiError(409, 'room_full', 'The room is full');
      }
      r.bindSeat(
        reservation.sessionId,
        { userId: session.userId, publicId: session.user.id, displayName: session.user.displayName },
        tokenHash,
      );
      return {
        name: reservation.name,
        roomId: reservation.roomId,
        processId: reservation.processId ?? matchMaker.processId,
        sessionId: reservation.sessionId,
      };
    },
    async close() {
      await matchMaker.gracefullyShutdown().catch(() => {});
      transport.shutdown();
    },
  };
}
