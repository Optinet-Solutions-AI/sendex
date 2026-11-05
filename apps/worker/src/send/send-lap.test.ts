import type { LapContext } from "@sendex/db";
import {
  createProviderRegistry,
  FakeProvider,
  type OutboundMessage,
  type Provider,
  type SubmitOutcome,
} from "@sendex/providers";
import { UnrecoverableError } from "bullmq";
import { describe, expect, it } from "vitest";
import type { SendLapJob } from "../jobs.js";
import { createLogger } from "../log.js";
import type { JobMeta } from "../queues.js";
import { createProgressTracker, progressKeys } from "./progress.js";
import { fakeRedis } from "./redis.fake.js";
import { type SendLapDeps, sendLap } from "./send-lap.js";
import { createFakeStore, type FakeMember, type FakeStoreOptions } from "./store.fake.js";

const quiet = createLogger({ write: () => undefined });

const IDS = {
  org: "org-1",
  campaign: "cmp-1",
  lap: "lap-1",
  list: "list-1",
  route: "route-1",
};

function context(overrides: Partial<LapContext> = {}): LapContext {
  return {
    lap: {
      id: IDS.lap,
      organisationId: IDS.org,
      campaignId: IDS.campaign,
      listId: IDS.list,
      routeId: IDS.route,
      testSize: 100,
      status: "sending",
      sent: 0,
      failed: 0,
      costMicro: 0n,
    },
    campaign: { id: IDS.campaign, status: "sending", contactReuse: "account_wide" },
    list: { id: IDS.list, country: "ES" },
    route: { id: IDS.route, provider: "fake", name: "fake-1", active: true, config: {} },
    senderIds: ["LUCKY777", "BIGSPINS"],
    texts: [
      { id: "t1", text: "Hi {{first_name}}, play at {{domain}}" },
      { id: "t2", text: "{{phone}} wins at {{domain}}" },
    ],
    link: { id: "link-1", url: "https://casino.test/?s={{dynamic}}" },
    priceMicro: 25_000n,
    ...overrides,
  };
}

function members(n: number, extra: Partial<FakeMember> = {}): FakeMember[] {
  return Array.from({ length: n }, (_, i) => ({
    contactId: `c${String(i + 1).padStart(3, "0")}`,
    e164: `+346000000${String(i + 1).padStart(2, "0")}`,
    firstName: i % 2 === 0 ? `Name${i}` : null,
    ...extra,
  }));
}

const job: SendLapJob = {
  organisationId: IDS.org,
  campaignId: IDS.campaign,
  lapId: IDS.lap,
  idempotencyKey: `lap:${IDS.lap}`,
};

function meta(delay?: (ms: number) => Promise<never>): JobMeta {
  return { id: "1", name: "send-lap", attemptsMade: 0, delay };
}

interface Harness {
  deps: SendLapDeps;
  store: ReturnType<typeof createFakeStore>;
  redis: ReturnType<typeof fakeRedis>;
  provider: FakeProvider;
}

function harness(
  storeOptions: Partial<FakeStoreOptions> = {},
  provider: Provider = new FakeProvider({ failEvery: 10 }),
  depOverrides: Partial<SendLapDeps> = {},
): Harness {
  const store = createFakeStore({
    ctx: context(),
    members: members(120),
    balanceMicro: 10_000_000n,
    ...storeOptions,
  });
  const redis = fakeRedis();
  const registry = createProviderRegistry().register("fake", provider);
  const deps: SendLapDeps = {
    store,
    providers: registry,
    redis,
    progress: createProgressTracker(redis),
    log: quiet,
    linksBaseUrl: "http://localhost:8787/",
    ...depOverrides,
  };
  return { deps, store, redis, provider: provider as FakeProvider };
}

describe("sendLap", () => {
  it("sends test_size messages in batches, records outcomes, money and progress", async () => {
    const { deps, store, redis, provider } = harness();
    const result = await sendLap(deps, job, meta());

    expect(result).toEqual({ outcome: "done", sent: 90, failed: 10 });
    expect(store.messages).toHaveLength(100);
    expect(store.messages.filter((m) => m.status === "sent")).toHaveLength(90);
    expect(store.messages.filter((m) => m.status === "failed")).toHaveLength(10);
    expect(provider.sent).toHaveLength(100);
    // Batches of 50.
    expect(store.calls.filter((c) => c === "claimAndCreateMessages")).toHaveLength(2);

    // Money: 100 debits, 10 refunds, balance down by 90 x 0.025.
    expect(store.ledger.filter((e) => e.kind === "debit")).toHaveLength(100);
    expect(store.ledger.filter((e) => e.kind === "refund")).toHaveLength(10);
    expect(await store.getBalanceMicro(IDS.org)).toBe(10_000_000n - 90n * 25_000n);

    // Members: sent_at set for the 90 accepted ones only.
    expect(store.members.filter((m) => m.sentAt)).toHaveLength(90);

    // Lap: counters, done, ranked.
    expect(store.lap).toMatchObject({
      status: "done",
      sent: 90,
      failed: 10,
      costMicro: 2_250_000n,
    });
    expect(store.lap.startedAt).toBeInstanceOf(Date);
    expect(store.lap.finishedAt).toBeInstanceOf(Date);
    expect(store.rankedCampaigns).toEqual([IDS.campaign]);
    expect(store.audits).toEqual([
      {
        action: "lap.finish",
        targetId: IDS.lap,
        details: {
          sent: 90,
          failed: 10,
          planned: 100,
          skipped: { bad: 0, alreadySent: 0, suppressed: 0, reused: 0 },
        },
      },
    ]);

    // Progress counters.
    expect(redis.data.get(progressKeys.lap(IDS.lap).sent)).toBe("90");
    expect(redis.data.get(progressKeys.lap(IDS.lap).failed)).toBe("10");
    expect(redis.data.get(progressKeys.lap(IDS.lap).total)).toBe("100");
    expect(redis.data.get(progressKeys.campaign(IDS.campaign).sent)).toBe("90");
    expect(redis.data.get(progressKeys.campaign(IDS.campaign).total)).toBe("100");
  });

  it("rotates sender ids and texts and renders placeholders with a tracked link", async () => {
    const { deps, store } = harness({}, new FakeProvider(), {
      shortCode: () => "abcdefgh",
      dynamicId: () => "dyn-1",
    });
    await sendLap(deps, job, meta());
    const [m0, m1, m2] = store.messages;
    expect(m0?.senderId).toBe("LUCKY777");
    expect(m1?.senderId).toBe("BIGSPINS");
    expect(m2?.senderId).toBe("LUCKY777");
    expect(m0?.text).toBe("Hi Name0, play at http://localhost:8787/abcdefgh");
    expect(m1?.text).toBe("+34600000002 wins at http://localhost:8787/abcdefgh");
    expect(m0).toMatchObject({
      shortCode: "abcdefgh",
      dynamicId: "dyn-1",
      encoding: "GSM_7BIT",
      parts: 1,
    });
    const outbound = (deps.providers.get("fake") as FakeProvider).sent[0];
    expect(outbound).toMatchObject({ to: "+34600000001", route: "fake-1", country: "ES" });
  });

  it("without a link renders {{domain}} empty and stores no short code", async () => {
    const { deps, store } = harness({ ctx: context({ link: null }) }, new FakeProvider());
    await sendLap(deps, job, meta());
    expect(store.messages[0]?.text).toBe("Hi Name0, play at ");
    expect(store.messages[0]?.shortCode).toBeNull();
  });

  it("charges parts x price for multi-part texts", async () => {
    const long = "x".repeat(200);
    const { deps, store } = harness(
      { ctx: context({ texts: [{ id: "t", text: long }], link: null }), members: members(2) },
      new FakeProvider(),
    );
    await sendLap(deps, job, meta());
    expect(store.messages[0]?.parts).toBe(2);
    expect(store.ledger.filter((e) => e.kind === "debit").map((e) => e.amountMicro)).toEqual([
      -50_000n,
      -50_000n,
    ]);
    expect(store.lap.costMicro).toBe(100_000n);
  });

  it("stops when the list runs out and lowers the lap total", async () => {
    const { deps, store, redis } = harness({ members: members(30) }, new FakeProvider());
    const result = await sendLap(deps, job, meta());
    expect(result).toEqual({ outcome: "done", sent: 30, failed: 0 });
    expect(store.lap.status).toBe("done");
    expect(redis.data.get(progressKeys.lap(IDS.lap).total)).toBe("30");
    expect(redis.data.get(progressKeys.campaign(IDS.campaign).total)).toBe("30");
  });

  it("refuses to start when the balance does not cover the estimated cost", async () => {
    const { deps, store } = harness({ balanceMicro: 2_000_000n }); // 100 x 25_000 = 2_500_000
    const result = await sendLap(deps, job, meta());
    expect(result).toMatchObject({ outcome: "cancelled", reason: "insufficient balance" });
    expect(store.messages).toHaveLength(0);
    expect(store.lap.status).toBe("cancelled");
    expect(store.audits).toEqual([
      { action: "lap.cancel", targetId: IDS.lap, details: { reason: "insufficient balance" } },
    ]);
  });

  it("parks the job when the campaign is paused and leaves the lap sending", async () => {
    const { deps, store } = harness({ campaignStatus: "paused" });
    const delays: number[] = [];
    const delay = async (ms: number): Promise<never> => {
      delays.push(ms);
      throw new Error("DelayedError stand-in");
    };
    await expect(sendLap(deps, job, meta(delay))).rejects.toThrow("DelayedError stand-in");
    expect(delays).toEqual([10_000]);
    expect(store.lap.status).toBe("sending");
    expect(store.messages).toHaveLength(0);
    // Without a delay hook (direct call) it reports the pause instead.
    expect(await sendLap(deps, job, meta())).toEqual({ outcome: "paused", sent: 0, failed: 0 });
  });

  it("cancels the lap when the campaign is stopped between batches", async () => {
    const inner = new FakeProvider();
    let calls = 0;
    const flipping: Provider = {
      name: "fake",
      async send(batch: readonly OutboundMessage[]): Promise<SubmitOutcome[]> {
        calls += 1;
        const out = await inner.send(batch);
        if (calls === 1) store.campaignStatus = "stopped";
        return out;
      },
      parseDeliveryReceipt: (raw) => inner.parseDeliveryReceipt(raw),
      priceFor: (route, country) => inner.priceFor(route, country),
      validateSenderId: (senderId, country) => inner.validateSenderId(senderId, country),
    };
    const { deps, store } = harness({}, flipping);
    const result = await sendLap(deps, job, meta());
    expect(result).toEqual({
      outcome: "cancelled",
      sent: 50,
      failed: 0,
      reason: "campaign stopped",
    });
    expect(store.messages).toHaveLength(50);
    expect(store.lap).toMatchObject({ status: "cancelled", sent: 50 });
    expect(store.audits.at(-1)).toMatchObject({ details: { reason: "campaign stopped" } });
    expect(store.rankedCampaigns).toEqual([]);
  });

  it("honours the emergency stop flag like a stop", async () => {
    const { deps, store, redis } = harness();
    redis.data.set(progressKeys.stop(IDS.org), "1");
    const result = await sendLap(deps, job, meta());
    expect(result).toMatchObject({ outcome: "cancelled", reason: "emergency stop" });
    expect(store.messages).toHaveLength(0);
  });

  it("resumes an interrupted lap: resubmits queued messages, creates no duplicates", async () => {
    const { deps, store } = harness({}, new FakeProvider());
    // Simulate an earlier attempt that created the first batch but crashed before submitting.
    await store.claimAndCreateMessages({
      lap: store.lap,
      eligibility: {
        organisationId: IDS.org,
        listId: IDS.list,
        campaignId: IDS.campaign,
        contactReuse: "account_wide",
      },
      limit: 50,
      priceMicro: 25_000n,
      build: (ms) =>
        ms.map((m) => ({
          contactId: m.contactId,
          e164: m.e164,
          senderId: "LUCKY777",
          text: "old",
          encoding: "GSM_7BIT",
          parts: 1,
          shortCode: null,
          dynamicId: "d",
        })),
    });
    expect(store.messages).toHaveLength(50);

    const result = await sendLap(deps, job, meta());
    expect(result).toEqual({ outcome: "done", sent: 100, failed: 0 });
    expect(store.messages).toHaveLength(100);
    expect(new Set(store.messages.map((m) => m.contactId)).size).toBe(100);
    expect(store.messages.filter((m) => m.text === "old" && m.status === "sent")).toHaveLength(50);
    expect(store.ledger.filter((e) => e.kind === "debit")).toHaveLength(100);
  });

  it("a parked lap carries on from the next unsent contact once the campaign resumes", async () => {
    const inner = new FakeProvider();
    let calls = 0;
    const pausing: Provider = {
      name: "fake",
      async send(batch: readonly OutboundMessage[]): Promise<SubmitOutcome[]> {
        calls += 1;
        const out = await inner.send(batch);
        if (calls === 1) store.campaignStatus = "paused";
        return out;
      },
      parseDeliveryReceipt: (raw) => inner.parseDeliveryReceipt(raw),
      priceFor: (route, country) => inner.priceFor(route, country),
      validateSenderId: (senderId, country) => inner.validateSenderId(senderId, country),
    };
    const { deps, store } = harness({}, pausing);
    // Paused after the first batch: the job parks, the lap stays `sending` at 50.
    expect(await sendLap(deps, job, meta())).toEqual({ outcome: "paused", sent: 50, failed: 0 });
    expect(store.lap).toMatchObject({ status: "sending", sent: 50 });
    expect(store.messages).toHaveLength(50);

    // Resume: the parked job runs again and finishes the lap without a duplicate.
    store.campaignStatus = "sending";
    expect(await sendLap(deps, job, meta())).toEqual({ outcome: "done", sent: 50, failed: 0 });
    expect(store.lap).toMatchObject({ status: "done", sent: 100 });
    expect(store.messages).toHaveLength(100);
    expect(new Set(store.messages.map((m) => m.contactId)).size).toBe(100);
    expect(store.ledger.filter((e) => e.kind === "debit")).toHaveLength(100);
  });

  it("a parked lap whose campaign was stopped (lap cancelled by the web) is a no-op", async () => {
    const { deps, store } = harness({ campaignStatus: "paused" });
    expect(await sendLap(deps, job, meta())).toEqual({ outcome: "paused", sent: 0, failed: 0 });
    // Stop from the campaign page: the db helper cancels the lap outright.
    store.campaignStatus = "stopped";
    store.lap.status = "cancelled";
    expect(await sendLap(deps, job, meta())).toEqual({
      outcome: "skipped",
      sent: 0,
      failed: 0,
      reason: "cancelled",
    });
    expect(store.messages).toHaveLength(0);
  });

  it("is a no-op for a lap that is already done or cancelled", async () => {
    const { deps, store } = harness();
    store.lap.status = "done";
    expect(await sendLap(deps, job, meta())).toEqual({
      outcome: "skipped",
      sent: 0,
      failed: 0,
      reason: "done",
    });
    expect(store.calls).toEqual(["loadLapContext"]);
  });

  it("cancels with a reason when the route cannot be used", async () => {
    const unknown = harness({ ctx: context({ route: { ...context().route, provider: "smpp" } }) });
    expect(await sendLap(unknown.deps, job, meta())).toMatchObject({
      outcome: "cancelled",
      reason: 'unknown provider "smpp"',
    });
    const unpriced = harness({ ctx: context({ priceMicro: null }) });
    expect(await sendLap(unpriced.deps, job, meta())).toMatchObject({
      outcome: "cancelled",
      reason: "no price for route in ES",
    });
    const noText = harness({ ctx: context({ texts: [] }) });
    expect(await sendLap(noText.deps, job, meta())).toMatchObject({
      outcome: "cancelled",
      reason: "campaign has no active text",
    });
  });

  it("fails unrecoverably for an unknown lap or a lap from another campaign", async () => {
    const { deps } = harness();
    await expect(sendLap(deps, { ...job, lapId: "nope" }, meta())).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
    await expect(sendLap(deps, { ...job, campaignId: "other" }, meta())).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
  });
});
