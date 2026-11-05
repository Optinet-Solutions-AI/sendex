import { randomUUID } from "node:crypto";
import type { RedisLike } from "./redis-like.js";
import { RATE_LIMIT_SCRIPT } from "./scripts.js";

export interface RateLimitInput {
  /** Identifier within the prefix, e.g. `login:203.0.113.9` or `send:org_123`. */
  key: string;
  /** Requests allowed per window. */
  max: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  /** Requests left in the window after this one. */
  remaining: number;
  /** Milliseconds until the oldest counted request leaves the window (a slot frees up). */
  resetMs: number;
  /** The `max` that was applied. */
  limit: number;
}

export type RateLimitHeaders = Record<string, string>;

/** Anything with `limit()`; the Hono middleware accepts this so tests can pass a fake. */
export interface RateLimiterLike {
  limit(input: RateLimitInput): Promise<RateLimitResult>;
}

export interface RateLimiter extends RateLimiterLike {
  /** `RateLimit-*` headers plus `Retry-After` when denied. Same as `rateLimitHeaders`. */
  headers(result: RateLimitResult): RateLimitHeaders;
}

export interface RateLimiterOptions {
  /** Key prefix, e.g. `sendex:rl`. Keys become `<prefix>:<key>`. */
  prefix: string;
  /** Clock in ms; defaults to `Date.now`. Injected by tests. */
  now?: () => number;
}

export type RateLimitScope = "ip" | "organisation" | "token";

export interface RateLimitPreset {
  name: string;
  max: number;
  windowMs: number;
  /** What the caller should key on. Documentation only; the caller supplies the key. */
  scope: RateLimitScope;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

export const RATE_LIMITS = {
  login: { name: "login", max: 10, windowMs: MINUTE_MS, scope: "ip" },
  upload: { name: "upload", max: 20, windowMs: HOUR_MS, scope: "organisation" },
  send: { name: "send", max: 60, windowMs: MINUTE_MS, scope: "organisation" },
  publicApi: { name: "publicApi", max: 600, windowMs: MINUTE_MS, scope: "token" },
  postback: { name: "postback", max: 1_000, windowMs: MINUTE_MS, scope: "organisation" },
} as const satisfies Record<string, RateLimitPreset>;

export type RateLimitPresetName = keyof typeof RATE_LIMITS;

function wholeSeconds(ms: number): number {
  return Math.ceil(Math.max(ms, 0) / 1000);
}

export function rateLimitHeaders(result: RateLimitResult): RateLimitHeaders {
  const headers: RateLimitHeaders = {
    "RateLimit-Limit": String(result.limit),
    "RateLimit-Remaining": String(result.remaining),
    "RateLimit-Reset": String(wholeSeconds(result.resetMs)),
  };
  if (!result.allowed) headers["Retry-After"] = String(Math.max(1, wholeSeconds(result.resetMs)));
  return headers;
}

function parseScriptReply(reply: unknown): { allowed: boolean; count: number; resetMs: number } {
  if (!Array.isArray(reply) || reply.length !== 3) {
    throw new Error(`rate limit script returned an unexpected reply: ${JSON.stringify(reply)}`);
  }
  const [allowed, count, resetMs] = reply.map(Number);
  if (
    allowed === undefined ||
    count === undefined ||
    resetMs === undefined ||
    [allowed, count, resetMs].some(Number.isNaN)
  ) {
    throw new Error(`rate limit script returned a non-numeric reply: ${JSON.stringify(reply)}`);
  }
  return { allowed: allowed === 1, count, resetMs };
}

export function createRateLimiter(redis: RedisLike, options: RateLimiterOptions): RateLimiter {
  const now = options.now ?? (() => Date.now());
  return {
    async limit({ key, max, windowMs }) {
      const at = now();
      const reply = await redis.eval(
        RATE_LIMIT_SCRIPT,
        1,
        `${options.prefix}:${key}`,
        at,
        windowMs,
        max,
        `${at}-${randomUUID()}`,
      );
      const { allowed, count, resetMs } = parseScriptReply(reply);
      return { allowed, remaining: Math.max(0, max - count), resetMs, limit: max };
    },
    headers: rateLimitHeaders,
  };
}
