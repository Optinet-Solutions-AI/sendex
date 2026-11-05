import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeRedis } from "./fake-redis.js";
import { createLeaderLock, type LeaderLostEvent } from "./leader-lock.js";
import { LEADER_RELEASE_SCRIPT, LEADER_RENEW_SCRIPT } from "./scripts.js";

describe("createLeaderLock", () => {
  let t = 0;
  const now = () => t;

  beforeEach(() => {
    t = 100_000;
    vi.useFakeTimers({ now: t });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Advance both the fake timers and the fake Redis clock together. */
  async function tick(ms: number): Promise<void> {
    t += ms;
    await vi.advanceTimersByTimeAsync(ms);
  }

  it("acquires with SET NX PX and reports leadership", async () => {
    const redis = createFakeRedis({ now });
    const lock = createLeaderLock(redis, { key: "lock:a", holderId: "h1", ttlMs: 1_000 });

    expect(lock.isLeader()).toBe(false);
    expect(await lock.acquire()).toBe(true);
    expect(lock.isLeader()).toBe(true);
    expect(redis.calls[0]).toEqual(["SET", "lock:a", "h1", "PX", 1_000, "NX"]);
    expect(await redis.get("lock:a")).toBe("h1");
    await lock.release();
  });

  it("does not acquire while another holder owns the key, and acquire is idempotent for the owner", async () => {
    const redis = createFakeRedis({ now });
    const a = createLeaderLock(redis, { key: "lock:a", holderId: "h1", ttlMs: 1_000 });
    const b = createLeaderLock(redis, { key: "lock:a", holderId: "h2", ttlMs: 1_000 });

    expect(await a.acquire()).toBe(true);
    expect(await b.acquire()).toBe(false);
    expect(b.isLeader()).toBe(false);

    const callsBefore = redis.calls.length;
    expect(await a.acquire()).toBe(true);
    expect(redis.calls.length).toBe(callsBefore);
    await a.release();
  });

  it("renews with the compare-and-extend script every renewEveryMs", async () => {
    const redis = createFakeRedis({ now });
    const lock = createLeaderLock(redis, {
      key: "lock:a",
      holderId: "h1",
      ttlMs: 1_000,
      renewEveryMs: 400,
    });
    await lock.acquire();

    await tick(400);
    expect(redis.calls.at(-1)).toEqual(["EVAL", LEADER_RENEW_SCRIPT, 1, "lock:a", "h1", 1_000]);
    expect(redis.pttl("lock:a")).toBe(1_000);

    await tick(400);
    expect(redis.pttl("lock:a")).toBe(1_000);
    expect(lock.isLeader()).toBe(true);
    await lock.release();
  });

  it("releases with the compare-and-delete script and stops renewing", async () => {
    const redis = createFakeRedis({ now });
    const lock = createLeaderLock(redis, {
      key: "lock:a",
      holderId: "h1",
      ttlMs: 1_000,
      renewEveryMs: 400,
    });
    await lock.acquire();
    await lock.release();

    expect(lock.isLeader()).toBe(false);
    expect(redis.calls.at(-1)).toEqual(["EVAL", LEADER_RELEASE_SCRIPT, 1, "lock:a", "h1"]);
    expect(await redis.get("lock:a")).toBeNull();

    const callsAfterRelease = redis.calls.length - 1;
    await tick(1_200);
    // Only the GET above, no renewals.
    expect(redis.calls.length).toBe(callsAfterRelease + 1);
  });

  it("never deletes a key held by someone else on release", async () => {
    const redis = createFakeRedis({ now });
    const a = createLeaderLock(redis, {
      key: "lock:a",
      holderId: "h1",
      ttlMs: 300,
      renewEveryMs: 5_000,
    });
    await a.acquire();
    await tick(300);
    await redis.set("lock:a", "h2", "PX", 1_000, "NX");

    await a.release();
    expect(await redis.get("lock:a")).toBe("h2");
  });

  it("calls onLost when the key expired or was taken before a renewal", async () => {
    const redis = createFakeRedis({ now });
    const lock = createLeaderLock(redis, {
      key: "lock:a",
      holderId: "h1",
      ttlMs: 300,
      renewEveryMs: 400,
    });
    const lost: LeaderLostEvent[] = [];
    lock.onLost((event) => lost.push(event));
    await lock.acquire();

    await tick(400);
    expect(lock.isLeader()).toBe(false);
    expect(lost).toEqual([{ key: "lock:a", holderId: "h1", cause: "expired" }]);

    // The timer is stopped: no further renew attempts or callbacks.
    const calls = redis.calls.length;
    await tick(800);
    expect(redis.calls.length).toBe(calls);
    expect(lost).toHaveLength(1);
  });

  it("treats a Redis error during renewal as losing the lock", async () => {
    const redis = createFakeRedis({ now });
    const lock = createLeaderLock(redis, {
      key: "lock:a",
      holderId: "h1",
      ttlMs: 1_000,
      renewEveryMs: 400,
    });
    const lost: LeaderLostEvent[] = [];
    lock.onLost((event) => lost.push(event));
    await lock.acquire();

    const failure = new Error("connection reset");
    redis.failNext(failure);
    await tick(400);

    expect(lock.isLeader()).toBe(false);
    expect(lost).toEqual([{ key: "lock:a", holderId: "h1", cause: "error", error: failure }]);
  });

  it("can re-acquire after losing the lock", async () => {
    const redis = createFakeRedis({ now });
    const lock = createLeaderLock(redis, {
      key: "lock:a",
      holderId: "h1",
      ttlMs: 1_000,
      renewEveryMs: 400,
    });
    await lock.acquire();
    await redis.del("lock:a"); // e.g. an operator cleared it
    await tick(400);
    expect(lock.isLeader()).toBe(false);

    expect(await lock.acquire()).toBe(true);
    expect(lock.isLeader()).toBe(true);
    await tick(400);
    expect(lock.isLeader()).toBe(true);
    await lock.release();
  });

  it("onLost returns an unsubscribe function", async () => {
    const redis = createFakeRedis({ now });
    const lock = createLeaderLock(redis, {
      key: "lock:a",
      holderId: "h1",
      ttlMs: 300,
      renewEveryMs: 400,
    });
    const lost: LeaderLostEvent[] = [];
    const off = lock.onLost((event) => lost.push(event));
    off();
    await lock.acquire();
    await tick(400);
    expect(lost).toEqual([]);
  });

  it("applies the documented defaults", () => {
    const redis = createFakeRedis({ now });
    const lock = createLeaderLock(redis, { key: "lock:a", holderId: "h1" });
    expect(lock.options).toEqual({
      key: "lock:a",
      holderId: "h1",
      ttlMs: 15_000,
      renewEveryMs: 5_000,
    });
  });
});
