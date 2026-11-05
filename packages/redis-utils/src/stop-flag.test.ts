import { describe, expect, it } from "vitest";
import { createFakeRedis } from "./fake-redis.js";
import {
  clearEmergencyStop,
  createStopFlagCache,
  emergencyStopKey,
  getEmergencyStop,
  isEmergencyStopped,
  setEmergencyStop,
} from "./stop-flag.js";

describe("emergencyStopKey", () => {
  it("is sendex:stop:<organisation>", () => {
    expect(emergencyStopKey("org_123")).toBe("sendex:stop:org_123");
  });
});

describe("setEmergencyStop / isEmergencyStopped / clearEmergencyStop", () => {
  it("stores a JSON record with no TTL and reports stopped", async () => {
    const redis = createFakeRedis();
    expect(await isEmergencyStopped(redis, "org_1")).toBe(false);

    const stop = await setEmergencyStop(redis, "org_1", {
      reason: "carrier complaint",
      byUserId: "usr_9",
      stoppedAt: "2026-11-06T10:00:00.000Z",
    });

    expect(stop).toEqual({
      reason: "carrier complaint",
      byUserId: "usr_9",
      stoppedAt: "2026-11-06T10:00:00.000Z",
    });
    expect(JSON.parse((await redis.get("sendex:stop:org_1")) ?? "")).toEqual(stop);
    expect(redis.pttl("sendex:stop:org_1")).toBe(-1);
    expect(await isEmergencyStopped(redis, "org_1")).toBe(true);
    expect(await isEmergencyStopped(redis, "org_2")).toBe(false);
    expect(await getEmergencyStop(redis, "org_1")).toEqual(stop);
  });

  it("defaults stoppedAt to the current time as ISO-8601", async () => {
    const redis = createFakeRedis();
    const before = Date.now();
    const stop = await setEmergencyStop(redis, "org_1", { reason: "r", byUserId: "u" });
    const at = Date.parse(stop.stoppedAt);
    expect(at).toBeGreaterThanOrEqual(before);
    expect(at).toBeLessThanOrEqual(Date.now());
  });

  it("clears the flag and reports whether one was set", async () => {
    const redis = createFakeRedis();
    await setEmergencyStop(redis, "org_1", { reason: "r", byUserId: "u" });

    expect(await clearEmergencyStop(redis, "org_1")).toBe(true);
    expect(await isEmergencyStopped(redis, "org_1")).toBe(false);
    expect(await getEmergencyStop(redis, "org_1")).toBeNull();
    expect(await clearEmergencyStop(redis, "org_1")).toBe(false);
  });

  it("treats any value as stopped even when it is not the expected JSON (fail safe)", async () => {
    const redis = createFakeRedis();
    await redis.set("sendex:stop:org_1", "1");

    expect(await isEmergencyStopped(redis, "org_1")).toBe(true);
    expect(await getEmergencyStop(redis, "org_1")).toEqual({
      reason: "unknown (unparseable flag: 1)",
      byUserId: "unknown",
      stoppedAt: "unknown",
    });
  });
});

describe("createStopFlagCache", () => {
  function setup() {
    let t = 1_000_000;
    const redis = createFakeRedis({ now: () => t });
    const cache = createStopFlagCache(redis, { ttlMs: 2_000, now: () => t });
    const advance = (ms: number): void => {
      t += ms;
    };
    const reads = () => redis.calls.filter((c) => c[0] === "GET").length;
    return { redis, cache, advance, reads };
  }

  it("reads Redis once per organisation per ttl", async () => {
    const { redis, cache, advance, reads } = setup();
    await setEmergencyStop(redis, "org_1", { reason: "r", byUserId: "u" });

    expect(await cache.isStopped("org_1")).toBe(true);
    expect(await cache.isStopped("org_1")).toBe(true);
    expect(await cache.isStopped("org_2")).toBe(false);
    expect(reads()).toBe(2);

    advance(1_999);
    await cache.isStopped("org_1");
    expect(reads()).toBe(2);

    advance(1);
    await cache.isStopped("org_1");
    expect(reads()).toBe(3);
  });

  it("sees a newly raised flag after the ttl", async () => {
    const { redis, cache, advance } = setup();
    expect(await cache.isStopped("org_1")).toBe(false);

    await setEmergencyStop(redis, "org_1", { reason: "r", byUserId: "u" });
    expect(await cache.isStopped("org_1")).toBe(false);
    advance(2_000);
    expect(await cache.isStopped("org_1")).toBe(true);
  });

  it("invalidate() drops one organisation or everything", async () => {
    const { redis, cache, reads } = setup();
    await cache.isStopped("org_1");
    await cache.isStopped("org_2");
    expect(reads()).toBe(2);

    await setEmergencyStop(redis, "org_1", { reason: "r", byUserId: "u" });
    cache.invalidate("org_1");
    expect(await cache.isStopped("org_1")).toBe(true);
    expect(await cache.isStopped("org_2")).toBe(false);
    expect(reads()).toBe(3);

    cache.invalidate();
    await cache.isStopped("org_1");
    await cache.isStopped("org_2");
    expect(reads()).toBe(5);
  });

  it("defaults the ttl to 2000 ms", () => {
    const redis = createFakeRedis();
    expect(createStopFlagCache(redis).ttlMs).toBe(2_000);
  });

  it("propagates Redis errors instead of caching them", async () => {
    const { redis, cache, reads } = setup();
    redis.failNext(new Error("down"));
    await expect(cache.isStopped("org_1")).rejects.toThrow("down");
    expect(await cache.isStopped("org_1")).toBe(false);
    expect(reads()).toBe(2);
  });
});
