import { describe, expect, it } from "vitest";
import { cachedQueueDepths, type DepthSource, queueDepths } from "./health.js";

function fakeQueue(name: string, counts: Record<string, number>): DepthSource {
  return {
    name,
    getJobCounts: async (...types: string[]) => {
      const out: Record<string, number> = {};
      for (const t of types) out[t] = counts[t] ?? 0;
      return out;
    },
  };
}

describe("queueDepths", () => {
  it("returns waiting, active, failed and delayed counts per queue", async () => {
    const depths = await queueDepths([
      fakeQueue("send", { waiting: 3, active: 1, failed: 2, delayed: 4, completed: 99 }),
      fakeQueue("send-dead", { waiting: 1 }),
    ]);
    expect(depths).toEqual({
      send: { waiting: 3, active: 1, failed: 2, delayed: 4 },
      "send-dead": { waiting: 1, active: 0, failed: 0, delayed: 0 },
    });
  });

  it("accepts a record of queues as well as a list", async () => {
    const depths = await queueDepths({ dlr: fakeQueue("dlr", { active: 2 }) });
    expect(depths).toEqual({ dlr: { waiting: 0, active: 2, failed: 0, delayed: 0 } });
  });

  it("returns an empty object when there are no queues", async () => {
    expect(await queueDepths([])).toEqual({});
  });
});

describe("cachedQueueDepths", () => {
  it("reads once per ttl, shares one read between concurrent probes, and never caches a failure", async () => {
    let clock = 1_000_000;
    let reads = 0;
    let fail = false;
    const read = async () => {
      reads += 1;
      if (fail) throw new Error("redis down");
      return { send: { waiting: reads, active: 0, failed: 0, delayed: 0 } };
    };
    const depths = cachedQueueDepths(read, 60_000, () => clock);

    const [a, b] = await Promise.all([depths(), depths()]);
    expect(a).toBe(b);
    expect(reads).toBe(1);

    clock += 30_000;
    expect((await depths()).send?.waiting).toBe(1);
    expect(reads).toBe(1);

    clock += 31_000;
    expect((await depths()).send?.waiting).toBe(2);
    expect(reads).toBe(2);

    clock += 61_000;
    fail = true;
    await expect(depths()).rejects.toThrow("redis down");
    fail = false;
    expect((await depths()).send?.waiting).toBe(4);
    expect(reads).toBe(4);
  });
});
