import type { Redis } from "ioredis";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createRateLimiter, type RateLimitResult } from "./rate-limit.js";
import { connect, reachable, sleep, uniquePrefix } from "./test-redis.js";

describe.skipIf(!reachable)("rate limiter (integration, needs Redis)", () => {
  let redis: Redis;
  let prefixes: string[] = [];

  beforeAll(() => {
    redis = connect();
  });

  afterEach(async () => {
    for (const prefix of prefixes) {
      const keys = await redis.keys(`${prefix}:*`);
      if (keys.length > 0) await redis.del(...keys);
    }
    prefixes = [];
  });

  afterAll(async () => {
    await redis.quit();
  });

  function limiter() {
    const prefix = uniquePrefix("rl");
    prefixes.push(prefix);
    return { prefix, limiter: createRateLimiter(redis, { prefix }) };
  }

  it("allows 10, denies the 11th, and allows again after the window", async () => {
    const { prefix, limiter: rl } = limiter();
    const windowMs = 300;
    const results: RateLimitResult[] = [];
    for (let i = 0; i < 11; i += 1) {
      results.push(await rl.limit({ key: "login:203.0.113.9", max: 10, windowMs }));
    }

    expect(results.slice(0, 10).every((r) => r.allowed)).toBe(true);
    expect(results.map((r) => r.remaining)).toEqual([9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 0]);
    const denied = results[10];
    expect(denied?.allowed).toBe(false);
    expect(denied?.limit).toBe(10);
    expect(denied?.resetMs).toBeGreaterThan(0);
    expect(denied?.resetMs).toBeLessThanOrEqual(windowMs);
    expect(await redis.zcard(`${prefix}:login:203.0.113.9`)).toBe(10);
    expect(await redis.pttl(`${prefix}:login:203.0.113.9`)).toBeLessThanOrEqual(windowMs);

    await sleep(windowMs + 50);
    const after = await rl.limit({ key: "login:203.0.113.9", max: 10, windowMs });
    expect(after.allowed).toBe(true);
    expect(after.remaining).toBe(9);
  });

  it("counts concurrent requests exactly once each", async () => {
    const { limiter: rl } = limiter();
    const results = await Promise.all(
      Array.from({ length: 15 }, () => rl.limit({ key: "send:org_1", max: 10, windowMs: 1_000 })),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(10);
    expect(results.filter((r) => !r.allowed)).toHaveLength(5);
  });
});
