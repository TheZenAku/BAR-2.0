import { randomUUID } from 'node:crypto';
import type { LevelDef, RapierApi } from '@bar/game-core';
import {
  API_PREFIX,
  DeleteAccountRequest,
  HealthResponse,
  LoginRequest,
  OpaqueToken,
  PROTOCOL_VERSION,
  PublicId,
  ReadinessResponse,
  RecoveryConfirmRequest,
  RecoveryRequest,
  RegisterRequest,
  SessionResponse,
} from '@bar/shared';
import cookie from '@fastify/cookie';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { type AuthenticatedUser, AuthService } from './auth/service.ts';
import { hashToken } from './auth/tokens.ts';
import type { Config } from './config.ts';
import { type Db, isDatabaseUnavailable, pingDatabase } from './db/database.ts';
import { attachGame, type GameServer } from './game/attach.ts';
import { ApiError, errorBody, parseInput, unauthenticated } from './http/errors.ts';
import { assertTrustedOrigin } from './http/origin-guard.ts';
import {
  DEFAULT_RATE_LIMITS,
  type RateAction,
  RateLimiter,
  type RateLimits,
  type RateRule,
} from './http/rate-limit.ts';
import type { Logger } from './logger.ts';
import type { Mailer } from './mail/mailer.ts';

export type AppConfig = Pick<
  Config,
  | 'SESSION_TTL_HOURS'
  | 'PASSWORD_RESET_TTL_MINUTES'
  | 'PUBLIC_APP_URL'
  | 'COOKIE_SECURE'
  | 'ALLOWED_ORIGINS'
  | 'TRUST_PROXY'
>;

export interface AppOptions {
  config: AppConfig;
  db: Db;
  logger: Logger;
  mailer: Mailer;
  version: string;
  rateLimits?: RateLimits;
  /** Multiplayer (M3). Omitted: no game room, `/api/v1/game/*` answers 404. */
  game?: GameOptions;
}

export interface GameOptions {
  rapier: RapierApi;
  level: LevelDef;
  maxPlayers: number;
  reconnectSeconds: number;
  /** How often connected sessions are re-checked for expiry. Default 15 s. */
  revalidateMs?: number;
}

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer',
  'cross-origin-resource-policy': 'same-origin',
} as const;

/** `__Host-` binds the cookie to this exact host over HTTPS (no Domain, Path=/); unavailable on plain-HTTP dev. */
export const sessionCookieName = (secure: boolean): string => (secure ? '__Host-bar_sid' : 'bar_sid');

export function buildApp(opts: AppOptions) {
  const { config, db, logger } = opts;
  const limits = opts.rateLimits ?? DEFAULT_RATE_LIMITS;
  const allowedOrigins = new Set(config.ALLOWED_ORIGINS);
  const auth = new AuthService({ db, mailer: opts.mailer, logger, config });
  const limiter = new RateLimiter();
  const cookieName = sessionCookieName(config.COOKIE_SECURE);
  const cookieOptions = {
    path: '/',
    httpOnly: true,
    secure: config.COOKIE_SECURE,
    sameSite: 'lax',
  } as const;
  const startedAt = performance.now();
  let draining = false;
  let game: GameServer | undefined;

  const app = Fastify({
    loggerInstance: logger,
    genReqId: () => randomUUID(),
    requestIdHeader: false, // never trust a client-supplied id
    trustProxy: config.TRUST_PROXY,
    bodyLimit: 16 * 1024,
    return503OnClosing: true,
  });
  app.register(cookie);

  if (opts.game) {
    const g = opts.game;
    app.addHook('onReady', async () => {
      game = await attachGame(
        app.server,
        {
          auth,
          rapier: g.rapier,
          level: g.level,
          logger,
          cookieName,
          maxPlayers: g.maxPlayers,
          reconnectSeconds: g.reconnectSeconds,
          revalidateMs: g.revalidateMs ?? 15_000,
        },
        allowedOrigins,
      );
    });
    // Before the listener closes: players get a clean close frame instead of a dropped socket.
    app.addHook('preClose', async () => {
      await game?.close();
    });
  }

  app.addHook('onRequest', async (req, reply) => {
    reply.headers({ ...SECURITY_HEADERS, 'x-request-id': req.id });
    if (req.url.startsWith(`${API_PREFIX}/`)) assertTrustedOrigin(req.method, req.headers, allowedOrigins);
  });

  app.setErrorHandler((err: Error, req, reply) => {
    if (err instanceof ApiError) {
      if (err.headers) reply.headers(err.headers);
      return reply.code(err.status).send(errorBody(err.code, err.message, req.id, err.issues));
    }
    if (isDatabaseUnavailable(err)) {
      req.log.warn({ err: { message: err.message, code: (err as { code?: unknown }).code } }, 'database unavailable');
      return reply.code(503).send(errorBody('service_unavailable', 'Service temporarily unavailable', req.id));
    }
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status === 415)
      return reply.code(415).send(errorBody('unsupported_media_type', 'Unsupported media type', req.id));
    if (status === 413) return reply.code(413).send(errorBody('payload_too_large', 'Payload too large', req.id));
    if (status >= 400 && status < 500) {
      return reply.code(400).send(errorBody('invalid_request', 'Malformed request', req.id));
    }
    req.log.error({ err }, 'unhandled error');
    return reply.code(500).send(errorBody('internal_error', 'Internal server error', req.id));
  });

  app.setNotFoundHandler((req, reply) => reply.code(404).send(errorBody('not_found', 'Not found', req.id)));

  // --- helpers ---------------------------------------------------------------------------------------------------

  const rateLimit = (action: string, rule: RateRule, key: string): void => {
    const retryAfter = limiter.hit(`${action}:${key}`, rule);
    if (retryAfter > 0) {
      throw new ApiError(429, 'rate_limited', 'Too many requests', { headers: { 'retry-after': String(retryAfter) } });
    }
  };
  const limitByIp = (action: RateAction, req: FastifyRequest): void =>
    rateLimit(action, limits[action].perIp, `ip:${req.ip}`);
  const limitByEmail = (action: RateAction, email: string): void => {
    const rule = limits[action].perEmail;
    if (rule) rateLimit(action, rule, `email:${email}`);
  };

  const readToken = (req: FastifyRequest): string | undefined => {
    const raw = req.cookies[cookieName];
    return raw !== undefined && OpaqueToken.safeParse(raw).success ? raw : undefined;
  };
  const setSessionCookie = (reply: FastifyReply, token: string): void => {
    reply.setCookie(cookieName, token, { ...cookieOptions, maxAge: config.SESSION_TTL_HOURS * 3600 });
  };
  const clearSessionCookie = (reply: FastifyReply): void => {
    reply.clearCookie(cookieName, cookieOptions);
  };
  const requireUser = async (req: FastifyRequest, reply: FastifyReply): Promise<AuthenticatedUser> => {
    const token = readToken(req);
    const session = token === undefined ? undefined : await auth.authenticate(token);
    if (!session) {
      if (req.cookies[cookieName] !== undefined) clearSessionCookie(reply);
      throw unauthenticated();
    }
    return session;
  };
  const sessionResponse = (user: SessionResponse['user']): SessionResponse => SessionResponse.parse({ user });

  // --- operational -----------------------------------------------------------------------------------------------

  app.get('/health', async () =>
    HealthResponse.parse({
      status: 'ok',
      version: opts.version,
      protocol: PROTOCOL_VERSION,
      uptimeSeconds: (performance.now() - startedAt) / 1000,
    }),
  );

  app.get('/ready', async (_req, reply) => {
    const up = !draining && (await pingDatabase(db));
    const body: ReadinessResponse = { status: up ? 'ready' : 'unavailable', checks: { database: up ? 'up' : 'down' } };
    return reply.code(up ? 200 : 503).send(ReadinessResponse.parse(body));
  });

  // --- auth (API v1) ---------------------------------------------------------------------------------------------

  app.post(`${API_PREFIX}/auth/register`, async (req, reply) => {
    limitByIp('register', req);
    const input = parseInput(RegisterRequest, req.body);
    const { user, token } = await auth.register(input);
    req.log.info({ user: user.id }, 'account registered');
    setSessionCookie(reply, token);
    return reply.code(201).send(sessionResponse(user));
  });

  app.post(`${API_PREFIX}/auth/login`, async (req, reply) => {
    limitByIp('login', req);
    const input = parseInput(LoginRequest, req.body);
    limitByEmail('login', input.email);
    const previous = readToken(req);
    const { user, token } = await auth.login(input);
    if (previous !== undefined) await auth.logout(previous); // rotate: never keep a pre-login session
    req.log.info({ user: user.id }, 'login');
    setSessionCookie(reply, token);
    return sessionResponse(user);
  });

  app.post(`${API_PREFIX}/auth/logout`, async (req, reply) => {
    const token = readToken(req);
    if (token !== undefined) await auth.logout(token);
    clearSessionCookie(reply);
    return reply.code(204).send();
  });

  app.get(`${API_PREFIX}/auth/session`, async (req, reply) => sessionResponse((await requireUser(req, reply)).user));

  app.post(`${API_PREFIX}/auth/recovery`, async (req, reply) => {
    limitByIp('recoveryRequest', req);
    const { email } = parseInput(RecoveryRequest, req.body);
    limitByEmail('recoveryRequest', email);
    await auth.requestRecovery(email);
    return reply.code(202).send();
  });

  app.post(`${API_PREFIX}/auth/recovery/confirm`, async (req, reply) => {
    limitByIp('recoveryConfirm', req);
    const { token, newPassword } = parseInput(RecoveryConfirmRequest, req.body);
    await auth.confirmRecovery(token, newPassword);
    req.log.info('password reset completed');
    return reply.code(204).send();
  });

  app.delete(`${API_PREFIX}/account`, async (req, reply) => {
    limitByIp('deleteAccount', req);
    const session = await requireUser(req, reply);
    const { password } = parseInput(DeleteAccountRequest, req.body);
    await auth.deleteAccount(session.userId, password);
    req.log.info({ user: session.user.id }, 'account deleted');
    clearSessionCookie(reply);
    return reply.code(204).send();
  });

  app.get<{ Params: { id: string } }>(`${API_PREFIX}/users/:id`, async (req, reply) => {
    await requireUser(req, reply);
    const id = parseInput(PublicId, req.params.id);
    const user = await auth.findPublicUser(id);
    if (!user) throw new ApiError(404, 'not_found', 'User not found');
    return sessionResponse(user);
  });

  if (opts.game) {
    app.post(`${API_PREFIX}/game/join`, async (req, reply) => {
      limitByIp('gameJoin', req);
      const session = await requireUser(req, reply);
      if (!game || draining) throw new ApiError(503, 'service_unavailable', 'Game server not ready');
      const reservation = await game.reserveSeat(session, hashToken(readToken(req)!));
      req.log.info({ user: session.user.id }, 'game seat reserved');
      return reservation;
    });
  }

  return Object.assign(app, {
    auth,
    /** The live game room, when multiplayer is enabled (tests and diagnostics). */
    game: () => game,
    /** Readiness turns 503 so load balancers stop routing before the listener closes. */
    startDraining(): void {
      draining = true;
    },
  });
}

export type App = ReturnType<typeof buildApp>;
