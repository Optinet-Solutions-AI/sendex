import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { contacts, ledgerEntries, listMembers, lists, suppressions } from "../schema/index.js";
import { createTestDb, seedOrganisation, type TestDb } from "../test/db.js";
import { getBalanceMicro } from "./ledger.js";
import {
  claimVerificationRequest,
  countUnverified,
  createVerificationRequest,
  deleteEnrichmentRule,
  finishVerificationRequest,
  listEnrichmentRules,
  listLookupCounts,
  listQueuedVerificationRequests,
  lookupCounts,
  lookupCoverage,
  lookupPriceFor,
  networkBreakdown,
  recordLookupResults,
  ruleUsage,
  scheduledEnrichmentRules,
  setLookupPrice,
  upsertEnrichmentRule,
  verificationLog,
  verificationTargets,
} from "./verification.js";

let t: TestDb;
let org: string;
let listId: string;
let archivedListId: string;

async function seedContact(e164: string, list: string, country = "ES"): Promise<string> {
  const [c] = await t.db
    .insert(contacts)
    .values({ organisationId: org, e164, country })
    .returning({ id: contacts.id });
  if (!c) throw new Error("seed");
  await t.db.insert(listMembers).values({ organisationId: org, listId: list, contactId: c.id });
  return c.id;
}

beforeAll(async () => {
  t = await createTestDb();
  org = await seedOrganisation(t.db, "org-a");
  const [l] = await t.db
    .insert(lists)
    .values({ organisationId: org, name: "ES list", country: "ES" })
    .returning({ id: lists.id });
  const [a] = await t.db
    .insert(lists)
    .values({ organisationId: org, name: "Old ES", country: "ES", archivedAt: new Date() })
    .returning({ id: lists.id });
  if (!l || !a) throw new Error("seed");
  listId = l.id;
  archivedListId = a.id;
  await seedContact("+34600000011", listId);
  await seedContact("+34600000026", listId);
  await seedContact("+34600000038", listId);
  await seedContact("+34600000049", listId);
  await seedContact("+34600000050", listId);
  await seedContact("+34600000077", archivedListId);
  await t.db
    .insert(suppressions)
    .values({ organisationId: org, e164: "+34600000050", reason: "unsubscribe", source: "manual" });
  await t.db.insert(ledgerEntries).values({
    organisationId: org,
    kind: "deposit",
    amountMicro: 1_000_000n,
    idempotencyKey: "dep",
  });
  await setLookupPrice(t.db, {
    country: "ES",
    route: "HLR 210",
    method: "hlr",
    priceMicro: 4_000n,
  });
  await setLookupPrice(t.db, {
    country: "GB",
    route: "MNP 331",
    method: "mnp",
    priceMicro: 1_000n,
  });
});

afterAll(async () => {
  await t.close();
});

describe("rules and coverage", () => {
  it("upserts one rule per country, lists it, and schedules the active ones", async () => {
    const rule = await upsertEnrichmentRule(t.db, org, {
      country: "ES",
      dailyLimit: 3,
      monthlyBudgetEur: "0.10",
      onSchedule: true,
      afterUpload: false,
      asYouSend: false,
      includeArchived: false,
    });
    expect(rule.monthlyBudgetMicro).toBe(100_000n);
    await upsertEnrichmentRule(t.db, org, {
      country: "ES",
      dailyLimit: 4,
      monthlyBudgetEur: "0.10",
      onSchedule: true,
      afterUpload: true,
      asYouSend: false,
      includeArchived: false,
    });
    const rules = await listEnrichmentRules(t.db, org);
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ country: "ES", dailyLimit: 4, afterUpload: true });
    expect((await scheduledEnrichmentRules(t.db)).map((r) => r.id)).toEqual([rule.id]);
    expect(await ruleUsage(t.db, rule.id)).toEqual({ verifiedToday: 0, spentThisMonthMicro: 0n });
  });

  it("knows the lookup price and coverage per country", async () => {
    expect(await lookupPriceFor(t.db, "es")).toMatchObject({
      route: "HLR 210",
      method: "hlr",
      priceMicro: 4_000n,
    });
    expect(await lookupPriceFor(t.db, "FR")).toBeNull();
    expect((await lookupCoverage(t.db)).map((c) => c.country)).toEqual(["ES", "GB"]);
  });
});

describe("requests", () => {
  it("counts and lists the unverified numbers of a list or country, archived lists aside", async () => {
    expect(await countUnverified(t.db, org, { listId })).toBe(5);
    expect(await countUnverified(t.db, org, { country: "ES" })).toBe(5);
    expect(await countUnverified(t.db, org, { country: "ES", includeArchived: true })).toBe(6);
    const request = await createVerificationRequest(t.db, org, {
      country: "ES",
      source: "hlr_verify",
      listId,
      limit: 3,
      requestedBy: null,
    });
    expect((await listQueuedVerificationRequests(t.db)).map((r) => r.id)).toEqual([request.id]);
    expect(await claimVerificationRequest(t.db, request.id)).not.toBeNull();
    expect(await claimVerificationRequest(t.db, request.id)).toBeNull();
    const targets = await verificationTargets(t.db, request);
    expect(targets).toHaveLength(3);
    expect(targets.every((x) => x.country === "ES")).toBe(true);
  });

  it("records results, debits each number, flags bad members and blacklists suppressed ones", async () => {
    const request = await createVerificationRequest(t.db, org, {
      country: "ES",
      source: "rule",
      limit: 10,
    });
    await recordLookupResults(t.db, {
      request,
      results: [
        { e164: "+34600000011", status: "hlr", method: "hlr", operator: "Movistar", ported: false },
        { e164: "+34600000026", status: "mnp", method: "hlr", operator: "Yoigo", ported: true },
        {
          e164: "+34600000038",
          status: "unresolved",
          method: "hlr",
          operator: null,
          ported: false,
        },
        { e164: "+34600000049", status: "bad", method: "hlr", operator: null, ported: false },
        { e164: "+34600000050", status: "hlr", method: "hlr", operator: "Movistar", ported: false },
      ],
      priceMicro: 4_000n,
      provider: "fake-lookup",
    });
    await finishVerificationRequest(t.db, request.id, "done");
    expect(await getBalanceMicro(t.db, org)).toBe(980_000n);
    const counts = await lookupCounts(t.db, org);
    expect(counts).toEqual({
      totalUnique: 6,
      byStatus: { hlr: 1, mnp: 1, unresolved: 1, bad: 1, blacklisted: 1 },
    });
    expect(await countUnverified(t.db, org, { listId })).toBe(0);
    const log = await verificationLog(t.db, org);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      country: "ES",
      total: 5,
      good: 2,
      bad: 2,
      noVerdict: 1,
      costMicro: 20_000n,
    });
    expect(await verificationLog(t.db, org, { country: "GB" })).toEqual([]);
    expect(await networkBreakdown(t.db, org)).toEqual([
      { country: "ES", operator: "Movistar", numbers: 2, ported: 0 },
      { country: "ES", operator: "Yoigo", numbers: 1, ported: 1 },
    ]);
    const [badMember] = await t.db
      .select({ bad: listMembers.bad, reason: listMembers.badReason })
      .from(listMembers)
      .innerJoin(contacts, sql`contacts.id = ${listMembers.contactId}`)
      .where(sql`contacts.e164 = '+34600000049'`);
    expect(badMember).toEqual({ bad: true, reason: "lookup" });
    expect(await listLookupCounts(t.db, org, listId)).toEqual([
      { country: "ES", hlr: 1, mnp: 1, unresolved: 1, localOnly: 0, checking: 0, cached: 5 },
    ]);
    // A second record of the same number updates the cache without a second debit.
    await recordLookupResults(t.db, {
      request,
      results: [
        {
          e164: "+34600000038",
          status: "hlr",
          method: "hlr",
          operator: "Orange Spain",
          ported: false,
        },
      ],
      priceMicro: 4_000n,
      provider: "fake-lookup",
    });
    expect(await getBalanceMicro(t.db, org)).toBe(980_000n);
    expect((await lookupCounts(t.db, org)).byStatus.unresolved).toBeUndefined();
    const rule = (await listEnrichmentRules(t.db, org))[0];
    expect(rule && (await deleteEnrichmentRule(t.db, org, rule.id))).toBe(true);
  });
});

import { sql } from "drizzle-orm";
