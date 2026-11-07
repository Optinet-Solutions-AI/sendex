import type { EnrichmentRuleRow, VerificationRequestRow } from "@sendex/db";
import { FakeLookupProvider } from "@sendex/providers";
import { describe, expect, it } from "vitest";
import { createLogger } from "../log.js";
import {
  dispatchVerification,
  runVerification,
  type VerificationDispatchStore,
  type VerificationStore,
} from "./run-verification.js";

const quiet = createLogger({ level: "error" });

function request(overrides: Partial<VerificationRequestRow> = {}): VerificationRequestRow {
  return {
    id: "r1",
    organisationId: "org",
    country: "ES",
    source: "hlr_verify",
    listId: "l1",
    ruleId: null,
    limit: 3,
    total: 0,
    good: 0,
    bad: 0,
    noVerdict: 0,
    costMicro: 0n,
    status: "queued",
    requestedBy: null,
    requestedAt: new Date(),
    finishedAt: null,
    ...overrides,
  };
}

function fakeStore(req: VerificationRequestRow | null, balance = 1_000_000n) {
  const recorded: Array<{ count: number; priceMicro: bigint }> = [];
  const finished: string[] = [];
  const store: VerificationStore = {
    claimVerificationRequest: async () => req,
    verificationTargets: async () => [
      { contactId: "c1", e164: "+34600000011", country: "ES" },
      { contactId: "c2", e164: "+34600000026", country: "ES" },
      { contactId: "c3", e164: "+34600000049", country: "ES" },
    ],
    recordLookupResults: async (input) => {
      recorded.push({ count: input.results.length, priceMicro: input.priceMicro });
    },
    finishVerificationRequest: async (_id, status) => {
      finished.push(status);
    },
    lookupPriceFor: async (country) => (country === "ES" ? { priceMicro: 4_000n } : null),
    getBalanceMicro: async () => balance,
    ruleIncludesArchived: async () => false,
  };
  return { store, recorded, finished };
}

describe("runVerification", () => {
  it("looks the targets up in batches, records each batch and finishes the request", async () => {
    const { store, recorded, finished } = fakeStore(request());
    const lookup = new FakeLookupProvider();
    const result = await runVerification(
      { store, lookup, log: quiet, batch: 2 },
      { organisationId: "org", requestId: "r1" },
    );
    expect(result).toEqual({ outcome: "done", verified: 3 });
    expect(recorded).toEqual([
      { count: 2, priceMicro: 4_000n },
      { count: 1, priceMicro: 4_000n },
    ]);
    expect(finished).toEqual(["done"]);
    expect(lookup.seen).toHaveLength(3);
  });

  it("fails without a provider or price, stops without balance, skips a taken request", async () => {
    const noProvider = fakeStore(request());
    expect(
      await runVerification(
        { store: noProvider.store, lookup: null, log: quiet },
        { organisationId: "org", requestId: "r1" },
      ),
    ).toEqual({
      outcome: "failed",
      verified: 0,
    });
    const noPrice = fakeStore(request({ country: "FR" }));
    expect(
      (
        await runVerification(
          { store: noPrice.store, lookup: new FakeLookupProvider(), log: quiet },
          { organisationId: "org", requestId: "r1" },
        )
      ).outcome,
    ).toBe("failed");
    const broke = fakeStore(request(), 1_000n);
    expect(
      await runVerification(
        { store: broke.store, lookup: new FakeLookupProvider(), log: quiet },
        { organisationId: "org", requestId: "r1" },
      ),
    ).toEqual({
      outcome: "done",
      verified: 0,
    });
    const taken = fakeStore(null);
    expect(
      (
        await runVerification(
          { store: taken.store, lookup: new FakeLookupProvider(), log: quiet },
          { organisationId: "org", requestId: "r1" },
        )
      ).outcome,
    ).toBe("skipped");
    await expect(
      runVerification(
        { store: fakeStore(request()).store, lookup: new FakeLookupProvider(), log: quiet },
        { organisationId: "other", requestId: "r1" },
      ),
    ).rejects.toThrow(/does not belong/);
  });
});

describe("dispatchVerification", () => {
  it("creates a request per rule with allowance and pending numbers, then enqueues queued requests", async () => {
    const rule: EnrichmentRuleRow = {
      id: "rule1",
      organisationId: "org",
      country: "ES",
      dailyLimit: 10,
      monthlyBudgetMicro: 100_000n,
      onSchedule: true,
      afterUpload: false,
      asYouSend: false,
      includeArchived: false,
      active: true,
      createdAt: new Date(),
    };
    const created: unknown[] = [];
    const added: unknown[] = [];
    const store: VerificationDispatchStore = {
      listQueuedVerificationRequests: async () => [request({ id: "q1" }), request({ id: "q2" })],
      scheduledEnrichmentRules: async () => [
        rule,
        { ...rule, id: "rule2", country: "FR" },
        { ...rule, id: "rule3", country: "GB" },
      ],
      ruleUsage: async (id) =>
        id === "rule1"
          ? { verifiedToday: 4, spentThisMonthMicro: 0n }
          : { verifiedToday: 0, spentThisMonthMicro: 0n },
      lookupPriceFor: async (country) => (country === "FR" ? null : { priceMicro: 4_000n }),
      countUnverified: async (_org, scope) => (scope.country === "GB" ? 0 : 50),
      createVerificationRequest: async (_org, input) => {
        created.push(input);
        return request({ id: "new", ...input });
      },
    };
    const queue = {
      add: async (_n: string, data: unknown, opts?: unknown) => void added.push({ data, opts }),
    };
    const result = await dispatchVerification({ store, queue, log: quiet });
    expect(result).toEqual({ enqueued: 2, created: 1 });
    // Rule 1: 10 a day minus 4 done = 6, and 50 pending → 6. FR has no price; GB nothing pending.
    expect(created).toEqual([{ country: "ES", source: "rule", ruleId: "rule1", limit: 6 }]);
    expect(added.map((a) => (a as { opts: { jobId: string } }).opts.jobId)).toEqual([
      "verify:q1",
      "verify:q2",
    ]);
  });
});
