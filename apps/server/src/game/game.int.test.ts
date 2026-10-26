// Multiplayer over real WebSockets: Colyseus SDK clients ↔ in-process server ↔ real PostgreSQL sessions.
import { GREYBOX_BAR, loadRapier, MOVEMENT, SIM_DT } from '@bar/game-core';
import { GameCloseCode, Msg, SessionResponse } from '@bar/shared';
import { matchMaker } from '@colyseus/core';
import { sql } from 'kysely';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { hashToken } from '../auth/tokens.ts';
import { gameBaseUrl, reserveSeat, sleep, TestPlayer, waitUntil } from '../testing/game-client.ts';
import { call, createTestContext, newAccount, ORIGIN, type TestContext } from '../testing/harness.ts';
import type { BarRoom } from './room.ts';
import { BUDGET_MAX_TICKS } from './world.ts';

let ctx: TestContext;
const players: TestPlayer[] = [];

beforeAll(async () => {
  ctx = await createTestContext({
    game: {
      rapier: await loadRapier(),
      level: GREYBOX_BAR,
      maxPlayers: 16,
      reconnectSeconds: 3,
      revalidateMs: 250,
    },
  });
});
afterEach(async () => {
  await Promise.all(players.splice(0).map((p) => p.leave().catch(() => {})));
  await waitUntil('room empty', () => room().playerCount === 0);
});
afterAll(() => ctx.close());

const room = (): BarRoom => ctx.app.game()!.room();

async function account() {
  const acc = newAccount('mp');
  const res = await call(ctx, 'POST', '/api/v1/auth/register', { body: acc });
  expect(res.status, res.raw).toBe(201);
  return { ...acc, token: res.sessionToken!, user: SessionResponse.parse(res.body).user };
}

async function join(token: string): Promise<TestPlayer> {
  const p = await TestPlayer.join(ctx, token);
  players.push(p);
  return p;
}

/** Network failure (no close frame), forced from the server side of the socket. */
function dropSocket(p: TestPlayer): void {
  const c = room().clients.find((x) => x.sessionId === p.room.sessionId);
  (c!.ref as unknown as WebSocket).terminate();
}

/** Raw handshake: resolves with the HTTP status of a refused upgrade, or 101 when the socket opens. */
function handshake(path: string, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`${gameBaseUrl(ctx).replace('http', 'ws')}${path}`, { headers });
    ws.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
    ws.on('open', () => {
      ws.terminate();
      resolve(101);
    });
    ws.on('error', () => resolve(-1));
  });
}

describe('authentication', () => {
  it('connects with the session cookie and receives identity, roster and snapshots', async () => {
    const a = await account();
    const p = await join(a.token);
    expect(p.welcome!.players).toEqual([{ pid: p.pid, id: a.user.id, name: a.user.displayName }]);
    expect(p.welcome!.max).toBe(16);
    await waitUntil('snapshots', () => p.snapshots.length >= 3);
    const s = p.last!;
    expect(s.me).toHaveLength(9);
    expect(s.p).toEqual([]);
    // Nothing account-internal leaks into game messages.
    expect(JSON.stringify([p.welcome, s])).not.toContain(a.email);
  });

  it('refuses the join route without a valid session', async () => {
    expect((await call(ctx, 'POST', '/api/v1/game/join')).status).toBe(401);
    expect((await call(ctx, 'POST', '/api/v1/game/join', { token: 'x'.repeat(43) })).status).toBe(401);
    const a = await account();
    const crossSite = await call(ctx, 'POST', '/api/v1/game/join', {
      token: a.token,
      headers: { origin: 'https://evil.example' },
    });
    expect(crossSite.status).toBe(403);
  });

  it('refuses WebSocket handshakes from other origins, without cookie or with another account', async () => {
    const a = await account();
    const b = await account();
    const seat = await reserveSeat(ctx, a.token);
    const path = `/game/${seat.processId}/${seat.roomId}?sessionId=${seat.sessionId}`;
    expect(await handshake(path, { origin: 'https://evil.example', cookie: `bar_sid=${a.token}` })).toBe(403);
    expect(await handshake(path, { cookie: `bar_sid=${a.token}` })).toBe(403);
    expect(await handshake(path, { origin: ORIGIN })).toBe(401);
    // B's valid session cannot consume A's seat.
    const client = TestPlayer.client(gameBaseUrl(ctx), { cookie: `bar_sid=${b.token}`, origin: ORIGIN });
    await expect(client.consumeSeatReservation(seat)).rejects.toThrow();
    expect(room().playerCount).toBe(0);
    // Unrelated upgrade paths are refused outright.
    expect(await handshake('/other', { origin: ORIGIN, cookie: `bar_sid=${a.token}` })).toBe(-1);
  });

  it('rejects an expired session and ends live connections when it expires', async () => {
    const a = await account();
    const p = await join(a.token);
    await sql`update sessions set created_at = now() - interval '2 hours', expires_at = now() - interval '1 second'
      where token_hash = ${hashToken(a.token)}`.execute(ctx.db);
    await waitUntil('kicked on revalidation', () => p.ended, 3000);
    expect(p.leftCode).toBe(GameCloseCode.SESSION_ENDED);
    expect((await call(ctx, 'POST', '/api/v1/game/join', { token: a.token })).status).toBe(401);
  });

  it('logout during the connection removes the player at once', async () => {
    const a = await account();
    const b = await account();
    const pa = await join(a.token);
    const pb = await join(b.token);
    await waitUntil('both in roster', () => pb.roster?.players.length === 2);
    const t0 = Date.now();
    expect((await call(ctx, 'POST', '/api/v1/auth/logout', { token: a.token })).status).toBe(204);
    await waitUntil('A kicked', () => pa.ended, 1000);
    expect(pa.leftCode).toBe(GameCloseCode.SESSION_ENDED);
    await waitUntil('B sees A leave', () => pb.roster?.players.length === 1, 1000);
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(pa.dropped).toBe(0); // a kick is not a drop: no reconnection attempt
  });
});

describe('shared room', () => {
  it('two players join, see each other and get distinct spawn points', async () => {
    const [a, b] = await Promise.all([account(), account()]);
    const [pa, pb] = await Promise.all([join(a.token), join(b.token)]);
    await waitUntil('rosters', () => pa.roster?.players.length === 2 && pb.roster?.players.length === 2);
    expect(pa.pid).not.toBe(pb.pid);
    await waitUntil('remote in snapshots', () => (pa.last?.p.length ?? 0) === 1 && (pb.last?.p.length ?? 0) === 1);
    const aSeenByB = pb.last!.p[0]!;
    expect(aSeenByB[0]).toBe(pa.pid);
    const [ax, , az] = pa.last!.me;
    const [bx, , bz] = pb.last!.me;
    expect(Math.hypot(ax - bx, az - bz)).toBeGreaterThan(1);
  });

  it('replicates movement, locomotion and server-side collision with the counter', async () => {
    const [a, b] = await Promise.all([account(), account()]);
    const pa = await join(a.token);
    const pb = await join(b.token);
    const startZ = pa.last?.me[2] ?? room().playerOf(a.user.id)!.sim.player.position.z;
    const remote = () => pb.last?.p.find((r) => r[0] === pa.pid);
    const walk = pa.drive(60, 1);
    await waitUntil('B sees A walking', () => remote()?.[6] === 1, 2000);
    await walk;
    await waitUntil('A moved for B', () => startZ - (remote()?.[3] ?? startZ) > 1.5, 2000);
    // Run into the bar counter (front face z = -4.15) for 3 s: the server stops A there.
    await pa.drive(180, 1, 0, true);
    await sleep(150);
    const counterLimit = -4.15 + 0.3 - 0.02;
    const server = room().playerOf(a.user.id)!.sim.player;
    expect(server.position.z).toBeGreaterThanOrEqual(counterLimit);
    expect(remote()![3]).toBeGreaterThanOrEqual(counterLimit);
    // B did not move: inputs only drive their own player.
    expect(Math.abs(pb.last!.me[2] - (pb.snapshots[0]?.me[2] ?? 0))).toBeLessThan(0.01);
  });

  it('acks the last applied input and reports the exact authoritative state', async () => {
    const a = await account();
    const p = await join(a.token);
    await p.drive(30, 1, 0.5);
    await waitUntil('acked', () => p.last?.a === 29, 2000);
    // Once the player has stopped, the latest snapshot must match the server state bit for bit.
    await waitUntil('stopped', () => room().playerOf(a.user.id)!.sim.player.speed === 0, 2000);
    const tick = room().stats().tick;
    await waitUntil('fresh snapshot', () => (p.last?.t ?? 0) > tick, 1000);
    const server = room().playerOf(a.user.id)!.sim.state();
    expect(p.last!.me.slice(0, 7)).toEqual([
      server.position.x,
      server.position.y,
      server.position.z,
      server.yaw,
      server.velocity.x,
      server.velocity.z,
      server.verticalSpeed,
    ]);
  });
});

describe('authority and abuse', () => {
  it('ignores client positions: only intent frames are accepted', async () => {
    const a = await account();
    const p = await join(a.token);
    await waitUntil('settled', () => p.last?.me[7] === 1);
    const before = p.last!.me.slice(0, 3);
    p.sendRaw(Msg.input, [[0, 0, 0, false, 0, { x: 50, y: 0, z: 50 }]]); // extra field: wrong tuple length
    p.sendRaw(Msg.input, { position: [50, 0, 50] });
    p.sendRaw(Msg.input, [[1, 50, 0, true, 0]]); // axis out of range
    p.sendRaw('teleport', { x: 50, z: 50 });
    await sleep(300);
    expect(p.ended).toBe(false);
    const after = p.last!.me.slice(0, 3);
    expect(Math.hypot(after[0]! - before[0]!, after[2]! - before[2]!)).toBeLessThan(1e-6);
    expect(room().playerOf(a.user.id)!.ackSeq).toBe(-1);
  });

  it('cannot move faster by flooding inputs (speed hack)', async () => {
    const a = await account();
    const p = await join(a.token);
    await waitUntil('settled', () => p.last?.me[7] === 1);
    const start = room().playerOf(a.user.id)!.sim.player.position;
    const t0 = performance.now();
    // 8 run frames every 10 ms ≈ 800 frames/s (13× the tick rate), sideways along +X across the open floor.
    for (let i = 0; i < 50; i++) {
      p.sendRaw(Msg.input, p.frames(8, 0, 1, true));
      await sleep(10);
    }
    await sleep(200);
    const seconds = (performance.now() - t0) / 1000;
    const end = room().playerOf(a.user.id)!.sim.player.position;
    const moved = Math.hypot(end.x - start.x, end.z - start.z);
    // Real time plus the jitter allowance (time budget cap) is the most any client can cover.
    expect(moved).toBeLessThanOrEqual(MOVEMENT.runSpeed * (seconds + BUDGET_MAX_TICKS * SIM_DT) + 0.1);
    expect(room().playerOf(a.user.id)!.counters.dropped).toBeGreaterThan(0);
    expect(p.ended).toBe(false);
  });

  it('applies duplicated and replayed input batches once', async () => {
    const a = await account();
    const p = await join(a.token);
    const batch = p.frames(2, 1);
    for (let i = 0; i < 20; i++) p.sendRaw(Msg.input, batch);
    await sleep(300);
    const server = room().playerOf(a.user.id)!;
    expect(server.ackSeq).toBe(1);
    expect(server.counters.duplicates).toBe(38);
  });

  it('closes connections that keep sending garbage', async () => {
    const a = await account();
    const p = await join(a.token);
    for (let i = 0; i < 25; i++) p.sendRaw('nonsense', i);
    await waitUntil('kicked', () => p.ended, 2000);
    expect(p.leftCode).toBe(GameCloseCode.PROTOCOL_VIOLATION);
    await waitUntil('removed', () => room().playerCount === 0);
  });
});

describe('lifecycle', () => {
  it('cleans up on leave and tells the others', async () => {
    const [a, b] = await Promise.all([account(), account()]);
    const pa = await join(a.token);
    const pb = await join(b.token);
    await waitUntil('2 players', () => pa.roster?.players.length === 2);
    await pb.leave();
    await waitUntil('A sees B leave', () => pa.roster?.players.length === 1, 1000);
    await waitUntil('no remote in snapshots', () => pa.last?.p.length === 0, 1000);
    expect(room().playerCount).toBe(1);
  });

  it('reconnects after a dropped socket, keeping identity and position', async () => {
    const a = await account();
    const p = await join(a.token);
    await p.drive(20, 1);
    await waitUntil('acked', () => p.last?.a === 19, 2000);
    await waitUntil('stopped', () => room().playerOf(a.user.id)!.sim.player.speed === 0, 2000);
    const pid = p.pid;
    const pos = room().playerOf(a.user.id)!.sim.player.position;
    dropSocket(p); // network failure, not a leave
    await waitUntil('reconnected', () => p.reconnected === 1, 5000);
    await waitUntil('welcome again', () => p.welcomes === 2, 2000);
    expect(p.welcome!.you).toBe(pid);
    expect(room().playerCount).toBe(1);
    const again = room().playerOf(a.user.id)!.sim.player.position;
    expect(Math.hypot(again.x - pos.x, again.z - pos.z)).toBeLessThan(1e-6);
    await p.drive(4, 1);
    await waitUntil('inputs after reconnect', () => (p.last?.a ?? 0) >= 23, 2000);
  });

  it('refuses a reconnection with another account cookie and frees the seat after the grace period', async () => {
    const [a, b] = await Promise.all([account(), account()]);
    const p = await join(a.token);
    const token = p.room.reconnectionToken.split(':')[1]!;
    const url = `/game/${matchMaker.processId}/${p.room.roomId}?sessionId=${p.room.sessionId}&reconnectionToken=${token}`;
    p.room.reconnection.enabled = false;
    dropSocket(p);
    await waitUntil('dropped', () => p.ended || p.dropped > 0, 2000);
    expect(await handshake(url, { origin: ORIGIN, cookie: `bar_sid=${b.token}` })).toBe(401);
    expect(room().playerCount).toBe(1); // still waiting for the real owner…
    await waitUntil('seat released after grace period', () => room().playerCount === 0, 6000); // …until it expires
  });

  it('one presence per account: a second connection replaces the first', async () => {
    const a = await account();
    const first = await join(a.token);
    const second = await join(a.token);
    await waitUntil('first replaced', () => first.ended, 2000);
    expect(first.leftCode).toBe(GameCloseCode.REPLACED);
    expect(room().playerCount).toBe(1);
    expect(second.ended).toBe(false);
  });

  it('isolates concurrent sessions: 8 accounts join at once, each moving only itself', async () => {
    const accounts = await Promise.all(Array.from({ length: 8 }, () => account()));
    const ps = await Promise.all(accounts.map((a) => join(a.token)));
    await waitUntil('all see 8', () => ps.every((p) => p.roster?.players.length === 8), 3000);
    expect(new Set(ps.map((p) => p.pid)).size).toBe(8);
    const at = () => accounts.map((a) => ({ ...room().playerOf(a.user.id)!.sim.player.position }));
    const before = at();
    await ps[3]!.drive(30, 1);
    await sleep(200);
    const moved = at().map((p, i) => Math.hypot(p.x - before[i]!.x, p.z - before[i]!.z));
    expect(moved.map((m) => m > 0.5)).toEqual(moved.map((_, i) => i === 3));
  });
});
