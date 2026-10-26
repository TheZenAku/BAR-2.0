// In-process fixed-window rate limiter. Single server process until M13 (ADR-0002), so no shared store is needed;
// moving to several processes requires replacing this with a shared store (documented in ADR-0004).

export interface RateRule {
  limit: number;
  windowMs: number;
}

const MIN = 60_000;
const HOUR = 60 * MIN;

export type RateAction = 'register' | 'login' | 'recoveryRequest' | 'recoveryConfirm' | 'deleteAccount' | 'gameJoin';
export type RateLimits = Record<RateAction, { perIp: RateRule; perEmail?: RateRule }>;

export const DEFAULT_RATE_LIMITS: RateLimits = {
  register: { perIp: { limit: 5, windowMs: HOUR } },
  login: { perIp: { limit: 20, windowMs: 15 * MIN }, perEmail: { limit: 10, windowMs: 15 * MIN } },
  recoveryRequest: { perIp: { limit: 5, windowMs: HOUR }, perEmail: { limit: 3, windowMs: HOUR } },
  recoveryConfirm: { perIp: { limit: 10, windowMs: 15 * MIN } },
  deleteAccount: { perIp: { limit: 5, windowMs: 15 * MIN } },
  // Reconnections reuse their seat; a full rejoin only follows a failed reconnection or a page reload.
  gameJoin: { perIp: { limit: 30, windowMs: MIN } },
};

const SWEEP_THRESHOLD = 10_000;

export class RateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  /** Counts one hit for `key`. Returns 0 when allowed, otherwise the seconds until the window resets. */
  hit(key: string, rule: RateRule): number {
    const now = this.now();
    if (this.windows.size >= SWEEP_THRESHOLD) this.sweep(now);
    let w = this.windows.get(key);
    if (!w || w.resetAt <= now) {
      w = { count: 0, resetAt: now + rule.windowMs };
      this.windows.set(key, w);
    }
    w.count++;
    return w.count <= rule.limit ? 0 : Math.max(1, Math.ceil((w.resetAt - now) / 1000));
  }

  get size(): number {
    return this.windows.size;
  }

  private sweep(now: number): void {
    for (const [key, w] of this.windows) if (w.resetAt <= now) this.windows.delete(key);
  }
}
