import type { Redis } from "ioredis";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createLeaderLock, type LeaderLock, type LeaderLostEvent } from "./leader-lock.js";
import { connect, reachable, sleep, uniquePrefix, waitFor } from "./test-redis.js";

describe.skipIf(!reachable)("leader lock (integration, needs Redis)", () => {
  let redis: Redis;
  let locks: LeaderLock[] = [];
  let keys: string[] = [];

  beforeAll(() => {
    redis = connect();
  });

  afterEach(async () => {
    await Promise.all(locks.map((lock) => lock.release()));
    if (keys.length > 0) await redis.del(...keys);
    locks = [];
    keys = [];
  });

  afterAll(async () => {
    await redis.quit();
  });

  type Timing = { ttlMs: number; renewEveryMs: number };
  const healthy: Timing = { ttlMs: 2_000, renewEveryMs: 100 };

  function pair(timingA: Timing, timingB: Timing): { key: string; a: LeaderLock; b: LeaderLock } {
    const key = uniquePrefix("leader");
    keys.push(key);
    const a = createLeaderLock(redis, { key, holderId: "holder-a", ...timingA });
    const b = createLeaderLock(redis, { key, holderId: "holder-b", ...timingB });
    locks.push(a, b);
    return { key, a, b };
  }

  it("lets only one of two locks on the same key acquire, and the other after release", async () => {
    const { key, a, b } = pair(healthy, healthy);

    const [gotA, gotB] = await Promise.all([a.acquire(), b.acquire()]);
    expect([gotA, gotB].filter(Boolean)).toHaveLength(1);
    const winner = gotA ? a : b;
    const loser = gotA ? b : a;
    expect(winner.isLeader()).toBe(true);
    expect(loser.isLeader()).toBe(false);
    expect(await redis.get(key)).toBe(winner.options.holderId);

    // Renewal keeps the key alive past its original TTL.
    await sleep(250);
    expect(await redis.get(key)).toBe(winner.options.holderId);
    expect(winner.isLeader()).toBe(true);

    await winner.release();
    expect(winner.isLeader()).toBe(false);
    await waitFor(() => loser.acquire(), 100, "the other lock to acquire after release");
    expect(loser.isLeader()).toBe(true);
    expect(await redis.get(key)).toBe(loser.options.holderId);
  });

  it("hands over when the holder stops renewing and its TTL runs out", async () => {
    // A's renew interval is longer than its TTL, so its first renewal only discovers the loss.
    const { key, a, b } = pair({ ttlMs: 200, renewEveryMs: 400 }, healthy);
    const lost: LeaderLostEvent[] = [];
    a.onLost((event) => lost.push(event));

    expect(await a.acquire()).toBe(true);
    expect(await b.acquire()).toBe(false);

    await waitFor(() => b.acquire(), 1_000, "the other lock to take over after expiry");
    expect(b.isLeader()).toBe(true);
    expect(await redis.get(key)).toBe("holder-b");

    await waitFor(() => lost.length > 0, 1_000, "the old holder to notice");
    expect(a.isLeader()).toBe(false);
    expect(lost).toEqual([{ key, holderId: "holder-a", cause: "expired" }]);

    // The old holder's release must not touch the new holder's key.
    await a.release();
    expect(await redis.get(key)).toBe("holder-b");
  });
});
