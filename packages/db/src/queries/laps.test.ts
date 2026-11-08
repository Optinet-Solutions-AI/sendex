import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  adTexts,
  auditLog,
  campaigns,
  contacts,
  laps,
  ledgerEntries,
  listMembers,
  lists,
  routePrices,
  routes,
} from "../schema/index.js";
import { createTestDb, seedOrganisation, type TestDb } from "../test/db.js";
import { getCampaign } from "./campaigns.js";
import { flushLap, rescheduleLap, setAllLapsOn, setLapComment, topUpLaps } from "./laps.js";
import { setLapOn } from "./results.js";
import { createSendingStore } from "./sending.js";

let t: TestDb;
let org: string;
let other: string;
let campaignId: string;
let listId: string;
let routeId: string;
let lapDone: string;
let lapQueued: string;
let lapOff: string;

async function seedLap(
  status: "queued" | "sending" | "done" | "cancelled",
  extra: Partial<typeof laps.$inferInsert> = {},
): Promise<string> {
  const [lap] = await t.db
    .insert(laps)
    .values({
      organisationId: org,
      campaignId,
      listId,
      routeId,
      testSize: 100,
      status,
      active: status !== "cancelled",
      ...extra,
    })
    .returning({ id: laps.id });
  if (!lap) throw new Error("lap insert failed");
  return lap.id;
}

beforeAll(async () => {
  t = await createTestDb();
  org = await seedOrganisation(t.db, "org-a");
  other = await seedOrganisation(t.db, "org-b");
  const [campaign] = await t.db
    .insert(campaigns)
    .values({ organisationId: org, name: "c", country: "ES", timezone: "Europe/Madrid" })
    .returning({ id: campaigns.id });
  const [list] = await t.db
    .insert(lists)
    .values({ organisationId: org, name: "l", country: "ES" })
    .returning({ id: lists.id });
  const [route] = await t.db
    .insert(routes)
    .values({ provider: "fake", name: "405", country: "ES" })
    .returning({ id: routes.id });
  if (!campaign || !list || !route) throw new Error("seed failed");
  campaignId = campaign.id;
  listId = list.id;
  routeId = route.id;
  await t.db
    .insert(routePrices)
    .values({ routeId, country: "ES", priceMicro: 25_000n, validFrom: new Date(0) });
  const [contact] = await t.db
    .insert(contacts)
    .values({ organisationId: org, e164: "+34600000001", country: "ES" })
    .returning({ id: contacts.id });
  if (!contact) throw new Error("seed failed");
  await t.db.insert(listMembers).values({
    organisationId: org,
    listId,
    contactId: contact.id,
    sentAt: new Date("2026-09-14T10:00:00Z"),
  });
  await t.db.insert(ledgerEntries).values({
    organisationId: org,
    kind: "deposit",
    amountMicro: 120_000_000n,
    idempotencyKey: "credit:test",
  });
});

afterAll(async () => {
  await t.close();
});

beforeEach(async () => {
  await t.db.delete(laps).where(eq(laps.campaignId, campaignId));
  await t.db.delete(auditLog).where(eq(auditLog.organisationId, org));
  lapDone = await seedLap("done", { sent: 100, finishedAt: new Date("2026-09-14T11:00:00Z") });
  lapQueued = await seedLap("queued");
  lapOff = await seedLap("cancelled");
});

describe("topUpLaps", () => {
  it("adds €50 to every active lap, buys 2,000 more messages each and re-queues a done lap", async () => {
    const result = await topUpLaps(t.db, org, {
      campaignId,
      amountMicro: 50_000_000,
      actorUserId: null,
    });
    expect(result).toEqual({ laps: 2, totalMicro: 100_000_000, newSms: 4_000 });

    const rows = await t.db.select().from(laps).where(eq(laps.campaignId, campaignId));
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(lapDone)).toMatchObject({
      status: "queued",
      finishedAt: null,
      testSize: 2_100,
      budgetMicro: 50_000_000n,
    });
    expect(byId.get(lapQueued)).toMatchObject({ testSize: 2_100, budgetMicro: 50_000_000n });
    expect(byId.get(lapOff)).toMatchObject({ testSize: 100, budgetMicro: 0n, status: "cancelled" });

    const audit = await t.db.select().from(auditLog).where(eq(auditLog.organisationId, org));
    expect(audit.map((a) => a.action)).toEqual(["lap.topup"]);
    expect(audit[0]?.details).toMatchObject({ amountMicro: "50000000", laps: 2, newSms: 4_000 });
  });

  it("buys half as many messages when the campaign's texts are two SMS parts", async () => {
    const [text] = await t.db
      .insert(adTexts)
      .values({ organisationId: org, campaignId, text: "x".repeat(200), encoding: "GSM_7BIT" })
      .returning({ id: adTexts.id });
    if (!text) throw new Error("seed failed");
    try {
      const result = await topUpLaps(t.db, org, {
        campaignId,
        amountMicro: 10_000_000,
        actorUserId: null,
      });
      expect(result).toEqual({ laps: 2, totalMicro: 20_000_000, newSms: 400 });
      const [queued] = await t.db.select().from(laps).where(eq(laps.id, lapQueued));
      expect(queued?.testSize).toBe(300);
    } finally {
      await t.db.delete(adTexts).where(eq(adTexts.id, text.id));
    }
  });

  it("refuses a top-up above the balance and one with no active lap", async () => {
    await expect(
      topUpLaps(t.db, org, { campaignId, amountMicro: 100_000_000, actorUserId: null }),
    ).rejects.toThrow(/balance/i);
    await expect(
      topUpLaps(t.db, other, { campaignId, amountMicro: 5_000_000, actorUserId: null }),
    ).rejects.toThrow(/no active lap/i);
  });
});

describe("setLapComment", () => {
  it("stores the note, trims it and clears it when empty, with an audit row", async () => {
    const saved = await setLapComment(t.db, org, {
      lapId: lapQueued,
      comment: "  best route so far  ",
      actorUserId: null,
    });
    expect(saved.comment).toBe("best route so far");
    const cleared = await setLapComment(t.db, org, {
      lapId: lapQueued,
      comment: "   ",
      actorUserId: null,
    });
    expect(cleared.comment).toBeNull();
    const audit = await t.db.select().from(auditLog).where(eq(auditLog.organisationId, org));
    expect(audit.map((a) => a.action)).toEqual(["lap.comment", "lap.comment"]);
    await expect(
      setLapComment(t.db, other, { lapId: lapQueued, comment: "x", actorUserId: null }),
    ).rejects.toThrow(/not found/i);
  });
});

describe("rescheduleLap", () => {
  it("holds a queued lap until the time, and the sending store does not claim it before", async () => {
    const later = new Date("2030-01-01T09:00:00Z");
    const lap = await rescheduleLap(t.db, org, {
      lapId: lapQueued,
      scheduledAt: later,
      actorUserId: null,
    });
    expect(lap.scheduledAt).toEqual(later);
    const store = createSendingStore(t.db);
    const before = await store.claimQueuedLaps(new Date("2029-12-31T09:00:00Z"));
    expect(before.map((l) => l.id)).not.toContain(lapQueued);
    const after = await store.claimQueuedLaps(new Date("2030-01-01T09:00:01Z"));
    expect(after.map((l) => l.id)).toContain(lapQueued);
  });

  it("only a queued lap can be rescheduled", async () => {
    await expect(
      rescheduleLap(t.db, org, { lapId: lapDone, scheduledAt: new Date(), actorUserId: null }),
    ).rejects.toThrow(/queued/i);
  });
});

describe("flushLap", () => {
  it("resets the lap's list so its contacts can be sent again", async () => {
    const result = await flushLap(t.db, org, { lapId: lapDone, actorUserId: null });
    expect(result).toEqual({ listId, members: 1 });
    const [member] = await t.db
      .select({ sentAt: listMembers.sentAt })
      .from(listMembers)
      .where(and(eq(listMembers.listId, listId), eq(listMembers.organisationId, org)));
    expect(member?.sentAt).toBeNull();
    const audit = await t.db.select().from(auditLog).where(eq(auditLog.organisationId, org));
    expect(audit.map((a) => a.action)).toEqual(["lap.flush"]);
  });
});

describe("active column and the All switch", () => {
  it("setLapOn keeps `active` in step with the status", async () => {
    const off = await setLapOn(t.db, org, { lapId: lapQueued, on: false, actorUserId: null });
    expect(off).toMatchObject({ status: "cancelled", active: false });
    const on = await setLapOn(t.db, org, { lapId: lapQueued, on: true, actorUserId: null });
    expect(on).toMatchObject({ status: "queued", active: true });
  });

  it("the sending store never claims a lap that is switched off", async () => {
    await t.db.update(laps).set({ active: false }).where(eq(laps.id, lapQueued));
    const store = createSendingStore(t.db);
    const claimed = await store.claimQueuedLaps(new Date());
    expect(claimed.map((l) => l.id)).not.toContain(lapQueued);
  });

  it("setAllLapsOn switches every unfinished lap of the campaign", async () => {
    const off = await setAllLapsOn(t.db, org, { campaignId, on: false, actorUserId: null });
    expect(off).toBe(1); // the queued one; done stays, cancelled is already off
    const rows = await t.db.select().from(laps).where(eq(laps.campaignId, campaignId));
    expect(rows.filter((r) => r.status === "cancelled")).toHaveLength(2);
    const on = await setAllLapsOn(t.db, org, { campaignId, on: true, actorUserId: null });
    expect(on).toBe(2);
    const detail = await getCampaign(t.db, org, campaignId);
    expect(detail?.laps.every((l) => l.priceMicro === 25_000n)).toBe(true);
    expect(detail?.laps.filter((l) => l.status === "queued")).toHaveLength(2);
  });
});
