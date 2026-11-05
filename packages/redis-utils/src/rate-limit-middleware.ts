import type { Context, Env, MiddlewareHandler } from "hono";
import {
  RATE_LIMITS,
  type RateLimiterLike,
  type RateLimitPreset,
  type RateLimitPresetName,
  rateLimitHeaders,
} from "./rate-limit.js";

export interface RateLimitMiddlewareOptions<E extends Env> {
  /** A `RATE_LIMITS` name or a preset object (for custom limits). */
  preset: RateLimitPresetName | RateLimitPreset;
  /** The identity to limit on (IP, organisation id, token id). Namespaced by the preset name. */
  keyFrom: (c: Context<E>) => string;
}

export interface RateLimitedBody {
  error: "rate_limited";
  retryAfterMs: number;
}

/**
 * Hono middleware: sets `RateLimit-*` headers on every response and answers
 * `429 { error: "rate_limited", retryAfterMs }` (plus `Retry-After`) when the limit is hit.
 */
export function rateLimit<E extends Env = Env>(
  limiter: RateLimiterLike,
  options: RateLimitMiddlewareOptions<E>,
): MiddlewareHandler<E> {
  const preset: RateLimitPreset =
    typeof options.preset === "string" ? RATE_LIMITS[options.preset] : options.preset;
  return async (c, next) => {
    const result = await limiter.limit({
      key: `${preset.name}:${options.keyFrom(c)}`,
      max: preset.max,
      windowMs: preset.windowMs,
    });
    for (const [name, value] of Object.entries(rateLimitHeaders(result))) c.header(name, value);
    if (!result.allowed) {
      const body: RateLimitedBody = { error: "rate_limited", retryAfterMs: result.resetMs };
      return c.json(body, 429);
    }
    await next();
  };
}
