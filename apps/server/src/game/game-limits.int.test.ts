// Configurable room capacity (GAME_MAX_PLAYERS): the seat route answers 409 `room_full` instead of opening a 2nd room.
import { GREYBOX_BAR, loadRapier } from '@bar/game-core';
import { ApiErrorResponse } from '@bar/shared';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { TestPlayer, waitUntil } from '../testing/game-client.ts';
import { call, createTestContext, newAccount, type TestContext } from '../testing/harness.ts';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext({
    game: { rapier: await loadRapier(), level: GREYBOX_BAR, maxPlayers: 2, reconnectSeconds: 3 },
  });
});
afterAll(() => ctx.close());

const token = async () => (await call(ctx, 'POST', '/api/v1/auth/register', { body: newAccount('cap') })).sessionToken!;

it('refuses players beyond the configured limit and frees the seat when someone leaves', async () => {
  const [a, b, c] = await Promise.all([token(), token(), token()]);
  const pa = await TestPlayer.join(ctx, a);
  const pb = await TestPlayer.join(ctx, b);
  const full = await call(ctx, 'POST', '/api/v1/game/join', { token: c });
  expect(full.status).toBe(409);
  expect(ApiErrorResponse.parse(full.body).error.code).toBe('room_full');
  expect(pa.welcome!.max).toBe(2);
  await pb.leave();
  await waitUntil('seat free', () => ctx.app.game()!.room().playerCount === 1);
  const pc = await TestPlayer.join(ctx, c);
  expect(pc.roster!.players).toHaveLength(2);
  await Promise.all([pa.leave(), pc.leave()]);
});
