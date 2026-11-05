import { describe, expect, it } from "vitest";
import { createFakeRedis } from "./fake-redis.js";

describe("createFakeRedis", () => {
  it("honours SET NX PX and lazy expiry on the injected clock", async () => {
    let t = 1_000;
    const redis = createFakeRedis({ now: () => t });

    expect(await redis.set("k", "a", "PX", 500, "NX")).toBe("OK");
    expect(await redis.set("k", "b", "PX", 500, "NX")).toBeNull();
    expect(await redis.get("k")).toBe("a");
    expect(redis.pttl("k")).toBe(500);

    t += 500;
    expect(await redis.get("k")).toBeNull();
    expect(redis.pttl("k")).toBe(-2);
    expect(await redis.set("k", "b", "PX", 500, "NX")).toBe("OK");
  });

  it("stores plain SET without expiry and DEL reports what it removed", async () => {
    const redis = createFakeRedis();
    await redis.set("k", "v");
    expect(redis.pttl("k")).toBe(-1);
    expect(await redis.del("k")).toBe(1);
    expect(await redis.del("k")).toBe(0);
  });

  it("rejects the next command when asked and recovers afterwards", async () => {
    const redis = createFakeRedis();
    redis.failNext(new Error("boom"));
    await expect(redis.get("k")).rejects.toThrow("boom");
    expect(await redis.get("k")).toBeNull();
  });

  it("refuses scripts it does not know", async () => {
    const redis = createFakeRedis();
    await expect(redis.eval("return 1", 1, "k")).rejects.toThrow(/unknown script/);
  });
});
