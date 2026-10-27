// Shared by the demos (scripts/demo.mjs, scripts/demo-remote.mjs): disposable accounts and the room check.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import pg from 'pg';

const ROOT = resolve(import.meta.dirname, '../..');
export const ACCOUNTS_FILE = join(ROOT, '.data', 'demo-accounts.json');
const DEMO_ACCOUNTS = [
  { email: 'ana.demo@bar.test', displayName: 'Ana Demo' },
  { email: 'beto.demo@bar.test', displayName: 'Beto Demo' },
];

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function waitFor(fn, timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await fn().catch(() => false)) return true;
    await sleep(150);
  }
  return false;
}

/** Disposable passwords: random, created on first run, reused afterwards (idempotent). Git-ignored, mode 600. */
export function loadOrCreateCredentials() {
  const stored = existsSync(ACCOUNTS_FILE) ? JSON.parse(readFileSync(ACCOUNTS_FILE, 'utf8')) : [];
  const accounts = DEMO_ACCOUNTS.map((a) => ({
    ...a,
    password: stored.find((s) => s.email === a.email)?.password ?? `demo-${randomBytes(9).toString('base64url')}`,
  }));
  writeFileSync(ACCOUNTS_FILE, `${JSON.stringify(accounts, null, 2)}\n`, { mode: 0o600 });
  return accounts;
}

/** `name=value` of the session cookie (`bar_sid`, or `__Host-bar_sid` when cookies are Secure). */
export const sessionCookie = (res) =>
  res.headers
    .getSetCookie()
    .find((c) => /^(__Host-)?bar_sid=/.test(c))
    ?.split(';')[0];

/**
 * Ensures the account exists with the demo password. Only ever runs against an isolated demo database:
 * `database` is the demo database name on the demo cluster at `adminUrl`.
 */
export async function ensureAccount(account, { apiBase, origin, adminUrl, database }) {
  const api = (path, init = {}) =>
    fetch(`${apiBase}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', origin, ...init.headers },
    });
  const login = () =>
    api('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: account.email, password: account.password }),
    });
  let res = await login();
  if (res.status === 401) {
    let reg = await api('/api/v1/auth/register', { method: 'POST', body: JSON.stringify(account) });
    if (reg.status === 409) {
      // Exists with another password (credentials file deleted): recreate it in the demo database only.
      const db = new pg.Client({ connectionString: adminUrl.replace(/\/postgres$/, `/${database}`) });
      await db.connect();
      await db.query('delete from users where email = $1', [account.email]);
      await db.end();
      reg = await api('/api/v1/auth/register', { method: 'POST', body: JSON.stringify(account) });
    }
    if (reg.status !== 201) throw new Error(`cadastro de ${account.email} retornou ${reg.status}`);
    res = reg;
  } else if (res.status !== 200) {
    throw new Error(`login de ${account.email} retornou ${res.status}`);
  }
  // Seeding must not leave sessions behind.
  const cookie = sessionCookie(res);
  if (cookie) await api('/api/v1/auth/logout', { method: 'POST', body: '{}', headers: { cookie } });
}

/**
 * The path a browser takes: every account logs in through `origin`, takes a seat, opens the game WebSocket and
 * must see the others in the shared room; then leaves and logs out (no sessions left behind).
 * `extraCookie` is sent along (e.g. the remote gateway's access cookie). Throws on failure.
 */
export async function verifyRoom(origin, accounts, extraCookie) {
  const cookies = (session) => [extraCookie, session].filter(Boolean).join('; ');
  const post = (path, session, body = {}) =>
    fetch(`${origin}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin, cookie: cookies(session) },
      body: JSON.stringify(body),
    });
  const { Client } = await import('@colyseus/sdk');
  const joined = [];
  try {
    for (const a of accounts) {
      const login = await post('/api/v1/auth/login', undefined, { email: a.email, password: a.password });
      if (login.status !== 200) throw new Error(`login de ${a.email} retornou ${login.status}`);
      const session = sessionCookie(login);
      const seat = await post('/api/v1/game/join', session);
      if (seat.status !== 200) throw new Error(`reserva de vaga retornou ${seat.status}`);
      const room = await new Client(`${origin}/game`, {
        headers: { cookie: cookies(session), origin },
      }).consumeSeatReservation(await seat.json());
      const entry = { room, session, players: 0 };
      room.onMessage('w', (w) => (entry.players = w.players.length));
      room.onMessage('r', (r) => (entry.players = r.players.length));
      room.onMessage('s', () => {});
      joined.push(entry);
    }
    if (!(await waitFor(async () => joined.every((j) => j.players === accounts.length), 10_000)))
      throw new Error('as contas não se viram na sala');
  } finally {
    for (const j of joined) {
      await j.room.leave(true).catch(() => {});
      await post('/api/v1/auth/logout', j.session);
    }
  }
}
