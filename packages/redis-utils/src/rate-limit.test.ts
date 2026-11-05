import { describe, expect, it } from "vitest";
import { createFakeRedis } from "./fake-redis.js";
import {
  createRateLimiter,
  RATE_LIMITS,
  type RateLimitResult,
  rateLimitHeaders,
} from "./rate-limit.js";
import { RATE_LIMIT_SCRIPT } from "./scripts.js";

describe("createRateLimiter", () => {
  function setup(start = 1_000_000) {
    let t = start;
    const redis = createFakeRedis({ now: () => t });
    const limiter = createRateLimiter(redis, { prefix: "rl", now: () => t });
    const advance = (ms: number): void => {
      t += ms;
    };
    return { redis, limiter, advance };
  }

  it("allows up to max requests in the window and then denies", async () => {
    const { limiter } = setup();
    const results: RateLimitResult[] = [];
    for (let i = 0; i < 4; i += 1) {
      results.push(await limiter.limit({ key: "login:1.2.3.4", max: 3, windowMs: 60_000 }));
    }
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(results.map((r) => r.remaining)).toEqual([2, 1, 0, 0]);
    expect(results.every((r) => r.limit === 3)).toBe(true);
  });

  it("runs the single sliding-window script under the prefixed key", async () => {
    const { redis, limiter } = setup(1_000_000);
    await limiter.limit({ key: "login:1.2.3.4", max: 3, windowMs: 60_000 });
    const call = redis.calls[0] ?? [];
    expect(call.slice(0, 7)).toEqual([
      "EVAL",
      RATE_LIMIT_SCRIPT,
      1,
      "rl:login:1.2.3.4",
      1_000_000,
      60_000,
      3,
    ]);
    expect(typeof call[7]).toBe("string");
    expect(redis.pttl("rl:login:1.2.3.4")).toBe(60_000);
  });

  it("uses a distinct member per request so same-millisecond hits all count", async () => {
    const { redis, limiter } = setup();
    await limiter.limit({ key: "k", max: 5, windowMs: 1_000 });
    await limiter.limit({ key: "k", max: 5, windowMs: 1_000 });
    expect(redis.zrange("rl:k")).toHaveLength(2);
  });

  it("does not consume budget for a denied request", async () => {
    const { redis, limiter } = setup();
    await limiter.limit({ key: "k", max: 1, windowMs: 1_000 });
    await limiter.limit({ key: "k", max: 1, windowMs: 1_000 });
    expect(redis.zrange("rl:k")).toHaveLength(1);
  });

  it("reports resetMs as the time until the oldest request leaves the window", async () => {
    const { limiter, advance } = setup();
    const first = await limiter.limit({ key: "k", max: 2, windowMs: 1_000 });
    expect(first.resetMs).toBe(1_000);

    advance(300);
    const second = await limiter.limit({ key: "k", max: 2, windowMs: 1_000 });
    expect(second.resetMs).toBe(700);

    advance(100);
    const denied = await limiter.limit({ key: "k", max: 2, windowMs: 1_000 });
    expect(denied).toEqual({ allowed: false, remaining: 0, resetMs: 600, limit: 2 });
  });

  it("slides: allows again once the oldest request is older than the window", async () => {
    const { limiter, advance } = setup();
    await limiter.limit({ key: "k", max: 2, windowMs: 1_000 });
    advance(500);
    await limiter.limit({ key: "k", max: 2, windowMs: 1_000 });
    advance(499);
    expect((await limiter.limit({ key: "k", max: 2, windowMs: 1_000 })).allowed).toBe(false);
    advance(1);
    const result = await limiter.limit({ key: "k", max: 2, windowMs: 1_000 });
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(0);
    expect(result.resetMs).toBe(500);
  });

  it("keeps separate keys independent", async () => {
    const { limiter } = setup();
    await limiter.limit({ key: "a", max: 1, windowMs: 1_000 });
    expect((await limiter.limit({ key: "a", max: 1, windowMs: 1_000 })).allowed).toBe(false);
    expect((await limiter.limit({ key: "b", max: 1, windowMs: 1_000 })).allowed).toBe(true);
  });

  it("exposes headers() for a result", () => {
    const { limiter } = setup();
    expect(limiter.headers({ allowed: true, remaining: 4, resetMs: 1_200, limit: 10 })).toEqual({
      "RateLimit-Limit": "10",
      "RateLimit-Remaining": "4",
      "RateLimit-Reset": "2",
    });
  });
});

describe("rateLimitHeaders", () => {
  it("omits Retry-After when allowed", () => {
    expect(rateLimitHeaders({ allowed: true, remaining: 9, resetMs: 60_000, limit: 10 })).toEqual({
      "RateLimit-Limit": "10",
      "RateLimit-Remaining": "9",
      "RateLimit-Reset": "60",
    });
  });

  it("adds Retry-After in whole seconds (at least 1) when denied", () => {
    expect(rateLimitHeaders({ allowed: false, remaining: 0, resetMs: 2_500, limit: 10 })).toEqual({
      "RateLimit-Limit": "10",
      "RateLimit-Remaining": "0",
      "RateLimit-Reset": "3",
      "Retry-After": "3",
    });
    expect(rateLimitHeaders({ allowed: false, remaining: 0, resetMs: 0, limit: 10 })).toMatchObject(
      {
        "Retry-After": "1",
      },
    );
  });
});

describe("RATE_LIMITS", () => {
  it("matches the card's presets", () => {
    expect(RATE_LIMITS).toEqual({
      login: { name: "login", max: 10, windowMs: 60_000, scope: "ip" },
      upload: { name: "upload", max: 20, windowMs: 3_600_000, scope: "organisation" },
      send: { name: "send", max: 60, windowMs: 60_000, scope: "organisation" },
      publicApi: { name: "publicApi", max: 600, windowMs: 60_000, scope: "token" },
      postback: { name: "postback", max: 1_000, windowMs: 60_000, scope: "organisation" },
    });
  });
});
