import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ledgerEntries, messages, routePrices, routes, smsTests } from "../schema/index.js";
import { createTestDb, seedOrganisation, type TestDb } from "../test/db.js";
import { getBalanceMicro } from "./ledger.js";
import {
  claimTest,
  createSmsTest,
  finishTest,
  listQueuedTests,
  listScheduledTests,
  listSmsTests,
  loadTestContext,
  recordTestMessage,
  removeSmsTest,
  testCostReport,
} from "./sms-tests.js";

let t: TestDb;
let org: string;
let platform: string;
let custom: string;

beforeAll(async () => {
  t = await createTestDb();
  org = await seedOrganisation(t.db, "org-a");
  const [p] = await t.db
    .insert(routes)
    .values({ provider: "platform", name: "405", country: "ES" })
    .returning({ id: routes.id });
  const [c] = await t.db
    .insert(routes)
    .values({
      organisationId: org,
      provider: "custom-http",
      name: "Mine",
      config: { apiUrl: "https://gw/{{{number}}}" },
    })
    .returning({ id: routes.id });
  if (!p || !c) throw new Error("seed");
  platform = p.id;
  custom = c.id;
  await t.db.insert(routePrices).values([
    { routeId: platform, country: "AD", priceMicro: 60_000n, validFrom: new Date(0) },
    { routeId: custom, country: "AD", priceMicro: 20_000n, validFrom: new Date(0) },
  ]);
  await t.db.insert(ledgerEntries).values({
    organisationId: org,
    kind: "deposit",
    amountMicro: 1_000_000n,
    idempotencyKey: "dep",
  });
});

afterAll(async () => {
  await t.close();
});

const base = {
  type: "single" as const,
  country: "AD",
  recipient: "376600000",
  senderModes: ["random_string" as const],
  customSender: "",
  textPresets: ["hi_no_domain" as const],
  customText: "",
  hypothesis: "",
  jitter: false,
  cascade: false,
  schedule: null,
  testNetworks: [],
};

describe("sms tests", () => {
  it("creates a queued single test, lists it with its route names, and claims it once", async () => {
    const test = await createSmsTest(t.db, org, { ...base, routeIds: [platform, custom] }, null);
    expect(test.queueStatus).toBe("queued");
    expect(test.recipient).toBe("+376600000");
    const listing = await listSmsTests(t.db, org, { page: 1, pageSize: 10 });
    expect(listing.total).toBe(1);
    expect(listing.rows[0]).toMatchObject({
      routeNames: ["405", "Mine"],
      scheduled: false,
      testsRan: 0,
    });
    expect(await listQueuedTests(t.db)).toEqual([{ id: test.id, organisationId: org }]);
    expect(await claimTest(t.db, test.id, null)).toBe(true);
    expect(await claimTest(t.db, test.id, null)).toBe(false);
    expect(await listQueuedTests(t.db)).toEqual([]);

    const ctx = await loadTestContext(t.db, test.id);
    expect(ctx?.routes.map((r) => [r.name, r.priceMicro, r.organisationId === null])).toEqual([
      ["405", 60_000n, true],
      ["Mine", 20_000n, false],
    ]);
    expect(ctx?.feeMicro).toBe(10_000n);

    // One accepted message on the custom route: debit plus fee; one failed on the platform route: nothing charged.
    await recordTestMessage(t.db, {
      testId: test.id,
      organisationId: org,
      routeId: custom,
      routeOrganisationId: org,
      e164: "+376600000",
      senderId: "ABCDE",
      text: "Hi, how are you?",
      encoding: "GSM_7BIT",
      parts: 1,
      status: "sent",
      providerMessageId: "pm1",
      errorCode: null,
      priceMicro: 20_000n,
      feeMicro: 10_000n,
    });
    await recordTestMessage(t.db, {
      testId: test.id,
      organisationId: org,
      routeId: platform,
      routeOrganisationId: null,
      e164: "+376600000",
      senderId: "ABCDE",
      text: "Hi, how are you?",
      encoding: "GSM_7BIT",
      parts: 1,
      status: "failed",
      providerMessageId: null,
      errorCode: "HTTP_500",
      priceMicro: 60_000n,
      feeMicro: 0n,
    });
    await finishTest(t.db, test.id, "done");
    const [row] = await t.db.select().from(smsTests).where(eq(smsTests.id, test.id));
    expect(row).toMatchObject({
      testsRan: 2,
      successCount: 1,
      costMicro: 30_000n,
      queueStatus: "done",
    });
    expect(await getBalanceMicro(t.db, org)).toBe(970_000n);
    const sent = await t.db.select().from(messages).where(eq(messages.testId, test.id));
    expect(sent).toHaveLength(2);
    expect(sent.every((m) => m.campaignId === null && m.lapId === null)).toBe(true);
    expect(await testCostReport(t.db, org)).toEqual([
      { month: new Date().toISOString().slice(0, 7), tests: 1, messages: 2, costMicro: 30_000n },
    ]);
  });

  it("keeps a scheduled test out of the queue, claims it once per slot and returns it to scheduled", async () => {
    const test = await createSmsTest(
      t.db,
      org,
      { ...base, routeIds: [platform], schedule: { days: [1, 2], times: ["09:00"] } },
      null,
    );
    expect(test.queueStatus).toBe("scheduled");
    expect(await listQueuedTests(t.db)).toEqual([]);
    expect(await listScheduledTests(t.db)).toEqual([
      { id: test.id, organisationId: org, days: [1, 2], times: ["09:00"], lastSlot: null },
    ]);
    expect(await claimTest(t.db, test.id, "2026-11-09T09:00")).toBe(true);
    expect(await claimTest(t.db, test.id, "2026-11-09T09:00")).toBe(false);
    await finishTest(t.db, test.id, "done");
    const [row] = await t.db.select().from(smsTests).where(eq(smsTests.id, test.id));
    expect(row?.queueStatus).toBe("scheduled");
    expect(row?.lastSlot).toBe("2026-11-09T09:00");
    expect(await claimTest(t.db, test.id, "2026-11-10T09:00")).toBe(true);

    expect(await removeSmsTest(t.db, org, test.id)).toBe(true);
    expect((await listSmsTests(t.db, org, { page: 1, pageSize: 10 })).total).toBe(1);
    expect(
      (await listSmsTests(t.db, org, { page: 1, pageSize: 10, showRemoved: true })).total,
    ).toBe(2);
    expect(await listScheduledTests(t.db)).toEqual([]);
  });
});
