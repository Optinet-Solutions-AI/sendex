import type { ClaimedLap } from "@sendex/db";
import { describe, expect, it } from "vitest";
import { createLogger } from "../log.js";
import { dispatchQueuedLaps, lapJobId } from "./dispatcher.js";

const quiet = createLogger({ write: () => undefined });

function fakeStore(batches: ClaimedLap[][]) {
  const unclaimed: string[] = [];
  return {
    unclaimed,
    store: {
      async claimQueuedLaps() {
        return batches.shift() ?? [];
      },
      async unclaimLap(lapId: string) {
        unclaimed.push(lapId);
      },
    },
  };
}

describe("dispatchQueuedLaps", () => {
  it("enqueues one send-lap job per claimed lap, keyed by the lap id", async () => {
    const added: Array<{ name: string; data: unknown; opts: unknown }> = [];
    const { store } = fakeStore([
      [
        { id: "L1", organisationId: "O1", campaignId: "C1" },
        { id: "L2", organisationId: "O1", campaignId: "C1" },
      ],
    ]);
    const queue = {
      async add(name: string, data: unknown, opts?: unknown) {
        added.push({ name, data, opts });
        return { id: "x" };
      },
    };
    const result = await dispatchQueuedLaps({ store, sendQueue: queue, log: quiet });
    expect(result).toEqual({ claimed: 2, enqueued: 2, failed: 0 });
    expect(added).toEqual([
      {
        name: "send-lap",
        data: { organisationId: "O1", campaignId: "C1", lapId: "L1", idempotencyKey: "lap:L1" },
        opts: { jobId: "lap-L1" },
      },
      {
        name: "send-lap",
        data: { organisationId: "O1", campaignId: "C1", lapId: "L2", idempotencyKey: "lap:L2" },
        opts: { jobId: "lap-L2" },
      },
    ]);
    // BullMQ rejects ":" in custom job ids.
    expect(lapJobId("L1")).toBe("lap-L1");
  });

  it("does nothing when no lap is dispatchable", async () => {
    const { store } = fakeStore([]);
    let adds = 0;
    const queue = {
      async add() {
        adds += 1;
        return {};
      },
    };
    expect(await dispatchQueuedLaps({ store, sendQueue: queue, log: quiet })).toEqual({
      claimed: 0,
      enqueued: 0,
      failed: 0,
    });
    expect(adds).toBe(0);
  });

  it("puts a lap back to queued when its job cannot be added, then throws", async () => {
    const { store, unclaimed } = fakeStore([
      [
        { id: "L1", organisationId: "O1", campaignId: "C1" },
        { id: "L2", organisationId: "O1", campaignId: "C1" },
      ],
    ]);
    const queue = {
      async add(_name: string, data: { lapId: string }) {
        if (data.lapId === "L1") throw new Error("redis gone");
        return {};
      },
    };
    await expect(dispatchQueuedLaps({ store, sendQueue: queue, log: quiet })).rejects.toThrow(
      /1 of 2 laps could not be enqueued/,
    );
    expect(unclaimed).toEqual(["L1"]);
  });
});
