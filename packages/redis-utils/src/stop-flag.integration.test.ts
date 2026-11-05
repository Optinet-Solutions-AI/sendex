import type { Redis } from "ioredis";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  clearEmergencyStop,
  createStopFlagCache,
  emergencyStopKey,
  getEmergencyStop,
  isEmergencyStopped,
  setEmergencyStop,
} from "./stop-flag.js";
import { connect, reachable, sleep, uniquePrefix } from "./test-redis.js";

describe.skipIf(!reachable)("emergency stop flag (integration, needs Redis)", () => {
  let redis: Redis;
  let orgs: string[] = [];

  beforeAll(() => {
    redis = connect();
  });

  afterEach(async () => {
    if (orgs.length > 0) await redis.del(...orgs.map(emergencyStopKey));
    orgs = [];
  });

  afterAll(async () => {
    await redis.quit();
  });

  function org(): string {
    const id = uniquePrefix("org");
    orgs.push(id);
    return id;
  }

  it("sets a persistent JSON flag, reads it back and clears it", async () => {
    const id = org();
    const stop = await setEmergencyStop(redis, id, { reason: "spam report", byUserId: "usr_1" });

    expect(await isEmergencyStopped(redis, id)).toBe(true);
    expect(await getEmergencyStop(redis, id)).toEqual(stop);
    expect(await redis.pttl(emergencyStopKey(id))).toBe(-1);

    expect(await clearEmergencyStop(redis, id)).toBe(true);
    expect(await isEmergencyStopped(redis, id)).toBe(false);
  });

  it("the cache notices a raised flag within its ttl", async () => {
    const id = org();
    const cache = createStopFlagCache(redis, { ttlMs: 100 });
    expect(await cache.isStopped(id)).toBe(false);

    await setEmergencyStop(redis, id, { reason: "r", byUserId: "u" });
    expect(await cache.isStopped(id)).toBe(false);
    await sleep(120);
    expect(await cache.isStopped(id)).toBe(true);
  });
});
