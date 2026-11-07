import type { TestContext, TestMessageInput } from "@sendex/db";
import { createProviderRegistry, FakeProvider } from "@sendex/providers";
import { describe, expect, it } from "vitest";
import { createLogger } from "../log.js";
import { dispatchDueTests } from "./dispatcher.js";
import { runSmsTest, type TestStore } from "./run-test.js";

const quiet = createLogger({ level: "error" });

function context(
  overrides: Partial<TestContext["test"]> = {},
  routes?: TestContext["routes"],
): TestContext {
  return {
    test: {
      id: "t1",
      organisationId: "org",
      type: "single",
      country: "AD",
      routeIds: ["r1", "r2"],
      senderModes: ["random_string", "custom"],
      customSender: "Brand",
      textPresets: ["hi_no_domain"],
      customText: null,
      recipient: "+376600000",
      testNetworks: [],
      hypothesis: null,
      jitter: false,
      cascade: false,
      scheduleDays: null,
      scheduleTimes: null,
      lastSlot: null,
      testsRan: 0,
      successCount: 0,
      costMicro: 0n,
      queueStatus: "running",
      removedAt: null,
      createdBy: null,
      createdAt: new Date(),
      lastSentAt: null,
      ...overrides,
    },
    routes: routes ?? [
      {
        id: "r1",
        organisationId: null,
        provider: "fake",
        name: "405",
        active: true,
        config: {},
        secret: null,
        priceMicro: 60_000n,
      },
      {
        id: "r2",
        organisationId: "org",
        provider: "custom-http",
        name: "Mine",
        active: true,
        config: {},
        secret: null,
        priceMicro: 20_000n,
      },
    ],
    feeMicro: 10_000n,
    history: ["old text"],
  };
}

function fakeStore(ctx: TestContext | null, balance = 1_000_000n) {
  const recorded: TestMessageInput[] = [];
  const finished: Array<"done" | "failed"> = [];
  const store: TestStore = {
    loadTestContext: async () => ctx,
    recordTestMessage: async (input) => {
      recorded.push(input);
      return `m${recorded.length}`;
    },
    finishTest: async (_id, outcome) => {
      finished.push(outcome);
    },
    getBalanceMicro: async () => balance,
  };
  return { store, recorded, finished };
}

describe("runSmsTest", () => {
  it("sends one message per combination and route, charging the accepted ones", async () => {
    const ctx = context();
    const { store, recorded, finished } = fakeStore(ctx);
    const providers = createProviderRegistry().register("fake", new FakeProvider());
    const result = await runSmsTest(
      { store, providers, log: quiet, rng: () => 0.1 },
      {
        organisationId: "org",
        testId: "t1",
        slotKey: null,
      },
    );
    // 2 sender modes × 1 text × 2 routes; the custom route is not servable here.
    expect(result).toEqual({ outcome: "done", sent: 2, failed: 2 });
    expect(recorded).toHaveLength(4);
    expect(recorded.filter((r) => r.status === "sent").map((r) => r.routeId)).toEqual(["r1", "r1"]);
    expect(recorded.filter((r) => r.status === "failed").map((r) => r.errorCode)).toEqual([
      "ROUTE_NOT_SERVABLE",
      "ROUTE_NOT_SERVABLE",
    ]);
    expect(recorded.map((r) => r.senderId)).toEqual(["CCCCC", "CCCCC", "Brand", "Brand"]);
    expect(recorded[0]?.text).toBe("Hi, how are you?");
    expect(recorded[0]).toMatchObject({ priceMicro: 60_000n, feeMicro: 0n, e164: "+376600000" });
    expect(recorded[1]).toMatchObject({ feeMicro: 10_000n });
    expect(finished).toEqual(["done"]);
  });

  it("stops at the first accepting route with cascade and refuses without balance", async () => {
    const routes: TestContext["routes"] = [
      {
        id: "r1",
        organisationId: null,
        provider: "fake",
        name: "405",
        active: true,
        config: {},
        secret: null,
        priceMicro: 60_000n,
      },
      {
        id: "r3",
        organisationId: null,
        provider: "fake",
        name: "403",
        active: true,
        config: {},
        secret: null,
        priceMicro: 50_000n,
      },
    ];
    const ctx = context({ cascade: true, senderModes: ["random_string"] }, routes);
    const providers = createProviderRegistry().register("fake", new FakeProvider());
    const cascade = fakeStore(ctx);
    expect(
      await runSmsTest(
        { store: cascade.store, providers, log: quiet },
        { organisationId: "org", testId: "t1", slotKey: null },
      ),
    ).toEqual({
      outcome: "done",
      sent: 1,
      failed: 0,
    });
    const broke = fakeStore(ctx, 10_000n);
    expect(
      await runSmsTest(
        { store: broke.store, providers, log: quiet },
        { organisationId: "org", testId: "t1", slotKey: null },
      ),
    ).toEqual({
      outcome: "failed",
      sent: 0,
      failed: 2,
    });
    expect(broke.recorded.every((r) => r.errorCode === "INSUFFICIENT_BALANCE")).toBe(true);
    expect(broke.finished).toEqual(["failed"]);
  });

  it("fails a handset test without a test-network provider and rejects a foreign job", async () => {
    const ctx = context({ type: "test", recipient: null });
    const { store, finished } = fakeStore(ctx);
    const providers = createProviderRegistry().register("fake", new FakeProvider());
    expect(
      await runSmsTest(
        { store, providers, log: quiet },
        { organisationId: "org", testId: "t1", slotKey: null },
      ),
    ).toMatchObject({
      outcome: "failed",
    });
    expect(finished).toEqual(["failed"]);
    await expect(
      runSmsTest(
        { store, providers, log: quiet },
        { organisationId: "other", testId: "t1", slotKey: null },
      ),
    ).rejects.toThrow(/does not belong/);
    await expect(
      runSmsTest(
        { store: fakeStore(null).store, providers, log: quiet },
        { organisationId: "org", testId: "t1", slotKey: null },
      ),
    ).rejects.toThrow(/not found/);
  });
});

describe("dispatchDueTests", () => {
  it("enqueues queued tests at once and scheduled ones in their slot, once", async () => {
    const claimed: Array<[string, string | null]> = [];
    const added: Array<{ data: unknown; opts: unknown }> = [];
    const store = {
      listQueuedTests: async () => [{ id: "q1", organisationId: "org" }],
      listScheduledTests: async () => [
        { id: "s1", organisationId: "org", days: [6], times: ["09:15"], lastSlot: null },
        {
          id: "s2",
          organisationId: "org",
          days: [6],
          times: ["09:15"],
          lastSlot: "2026-11-07T09:15",
        },
        { id: "s3", organisationId: "org", days: [1], times: ["09:15"], lastSlot: null },
      ],
      claimTest: async (id: string, slotKey: string | null) => {
        claimed.push([id, slotKey]);
        return true;
      },
    };
    const queue = {
      add: async (_n: string, data: unknown, opts?: unknown) => void added.push({ data, opts }),
    };
    // Saturday 7 Nov 2026, 09:20 UTC.
    const result = await dispatchDueTests({
      store,
      queue,
      log: quiet,
      now: () => new Date("2026-11-07T09:20:00Z"),
    });
    expect(result).toEqual({ enqueued: 2 });
    expect(claimed).toEqual([
      ["q1", null],
      ["s1", "2026-11-07T09:15"],
    ]);
    expect(added.map((a) => a.opts)).toEqual([
      { jobId: "sms-test:q1" },
      { jobId: "sms-test:s1:2026-11-07T09:15" },
    ]);
  });
});
