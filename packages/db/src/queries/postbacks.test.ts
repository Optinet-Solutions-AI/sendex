import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adTexts, campaigns, contacts, laps, lists, messages, routes } from "../schema/index.js";
import { createTestDb, seedOrganisation, type TestDb } from "../test/db.js";
import {
  attributePostback,
  conversionStats,
  findPostbackByEventKey,
  insertPostback,
  listPostbacks,
} from "./postbacks.js";

let t: TestDb;
let org: string;
let otherOrg: string;
let campaignId: string;
let lap1: string;
let lap2: string;
let text1: string;
let text2: string;
const messageIds: Record<string, string> = {};

interface MessageSpec {
  dyn: string;
  lapId: string;
  senderId: string;
  adTextId: string | null;
}

beforeAll(async () => {
  t = await createTestDb();
  org = await seedOrganisation(t.db, "org-a");
  otherOrg = await seedOrganisation(t.db, "org-b");
  const [campaign] = await t.db
    .insert(campaigns)
    .values({ organisationId: org, name: "Spring ES", country: "ES", timezone: "Europe/Madrid" })
    .returning({ id: campaigns.id });
  const [list] = await t.db
    .insert(lists)
    .values({ organisationId: org, name: "l", country: "ES" })
    .returning({ id: lists.id });
  const [route] = await t.db
    .insert(routes)
    .values({ provider: "fake", name: "405", country: "ES" })
    .returning({ id: routes.id });
  const [contact] = await t.db
    .insert(contacts)
    .values({ organisationId: org, e164: "+34600000001", country: "ES" })
    .returning({ id: contacts.id });
  if (!campaign || !list || !route || !contact) throw new Error("setup failed");
  campaignId = campaign.id;
  const lapRows = await t.db
    .insert(laps)
    .values([
      {
        organisationId: org,
        campaignId,
        listId: list.id,
        routeId: route.id,
        testSize: 200,
        sent: 4,
        costMicro: 100_000n,
        createdAt: new Date("2026-11-05T10:00:00Z"),
      },
      {
        organisationId: org,
        campaignId,
        listId: list.id,
        routeId: route.id,
        testSize: 200,
        sent: 2,
        costMicro: 60_000n,
        createdAt: new Date("2026-11-05T11:00:00Z"),
      },
    ])
    .returning({ id: laps.id });
  const textRows = await t.db
    .insert(adTexts)
    .values([
      { organisationId: org, campaignId, text: "text one", encoding: "GSM_7BIT", position: 0 },
      { organisationId: org, campaignId, text: "text two", encoding: "GSM_7BIT", position: 1 },
    ])
    .returning({ id: adTexts.id });
  const [l1, l2] = lapRows;
  const [t1, t2] = textRows;
  if (!l1 || !l2 || !t1 || !t2) throw new Error("setup failed");
  lap1 = l1.id;
  lap2 = l2.id;
  text1 = t1.id;
  text2 = t2.id;
  const specs: MessageSpec[] = [
    { dyn: "d1", lapId: lap1, senderId: "SID1", adTextId: text1 },
    { dyn: "d2", lapId: lap1, senderId: "SID1", adTextId: text2 },
    { dyn: "d3", lapId: lap1, senderId: "SID2", adTextId: text1 },
    { dyn: "d4", lapId: lap1, senderId: "SID2", adTextId: text2 },
    { dyn: "d5", lapId: lap2, senderId: "SID1", adTextId: text1 },
    { dyn: "d6", lapId: lap2, senderId: "SID2", adTextId: null },
  ];
  for (const spec of specs) {
    const [row] = await t.db
      .insert(messages)
      .values({
        organisationId: org,
        campaignId,
        lapId: spec.lapId,
        contactId: contact.id,
        routeId: route.id,
        e164: "+34600000001",
        senderId: spec.senderId,
        text: "hi",
        encoding: "GSM_7BIT",
        status: "sent",
        dynamicId: spec.dyn,
        adTextId: spec.adTextId,
        idempotencyKey: `k-${spec.dyn}`,
      })
      .returning({ id: messages.id });
    if (!row) throw new Error("setup failed");
    messageIds[spec.dyn] = row.id;
  }
});

afterAll(async () => {
  await t.close();
});

const at = (iso: string) => new Date(iso);

describe("insertPostback", () => {
  it("inserts a new event and reports a duplicate event key without throwing", async () => {
    const first = await insertPostback(t.db, org, {
      eventKey: "lead_d1",
      type: "lead",
      dynamicId: "d1",
      valueMicro: null,
      params: { type: "lead", dynamic_id: "d1" },
      receivedAt: at("2026-11-06T10:00:00Z"),
    });
    expect(first.inserted).toBe(true);
    expect(first.postback).toMatchObject({
      organisationId: org,
      eventKey: "lead_d1",
      type: "lead",
      dynamicId: "d1",
      messageId: null,
      valueMicro: null,
      params: { type: "lead", dynamic_id: "d1" },
    });
    const again = await insertPostback(t.db, org, {
      eventKey: "lead_d1",
      type: "lead",
      dynamicId: "d1",
      valueMicro: null,
      params: { replay: "yes" },
      receivedAt: at("2026-11-06T11:00:00Z"),
    });
    expect(again.inserted).toBe(false);
    expect(again.postback.id).toBe(first.postback.id);
    expect(again.postback.params).toEqual({ type: "lead", dynamic_id: "d1" });
  });

  it("stores a sale value in micro-EUR", async () => {
    const sale = await insertPostback(t.db, org, {
      eventKey: "sale_d1",
      type: "sale",
      dynamicId: "d1",
      valueMicro: 10_000_000,
      params: { type: "sale", dynamic_id: "d1", value: "10" },
      receivedAt: at("2026-11-06T10:05:00Z"),
    });
    expect(sale.inserted).toBe(true);
    expect(sale.postback.valueMicro).toBe(10_000_000n);
  });
});

describe("findPostbackByEventKey", () => {
  it("finds an event of the organisation only", async () => {
    const found = await findPostbackByEventKey(t.db, org, "lead_d1");
    expect(found?.dynamicId).toBe("d1");
    await expect(findPostbackByEventKey(t.db, otherOrg, "lead_d1")).resolves.toBeNull();
    await expect(findPostbackByEventKey(t.db, org, "nope")).resolves.toBeNull();
  });
});

describe("attributePostback", () => {
  it("links the postback to the message by dynamic id and counts the lap lead", async () => {
    const stored = await findPostbackByEventKey(t.db, org, "lead_d1");
    if (!stored) throw new Error("missing");
    const result = await attributePostback(t.db, stored);
    expect(result.attributed).toBe(true);
    expect(result.postback).toMatchObject({
      messageId: messageIds.d1,
      campaignId,
      lapId: lap1,
    });
    const [lap] = await t.db.select().from(laps).where(eq(laps.id, lap1));
    expect(lap?.leads).toBe(1);
    expect(lap?.sales).toBe(0);
  });

  it("does not count twice when attributed again", async () => {
    const stored = await findPostbackByEventKey(t.db, org, "lead_d1");
    if (!stored) throw new Error("missing");
    const result = await attributePostback(t.db, stored);
    expect(result.attributed).toBe(false);
    expect(result.postback.lapId).toBe(lap1);
    const [lap] = await t.db.select().from(laps).where(eq(laps.id, lap1));
    expect(lap?.leads).toBe(1);
  });

  it("counts a sale with its value on the lap", async () => {
    const stored = await findPostbackByEventKey(t.db, org, "sale_d1");
    if (!stored) throw new Error("missing");
    const result = await attributePostback(t.db, stored);
    expect(result.attributed).toBe(true);
    const [lap] = await t.db.select().from(laps).where(eq(laps.id, lap1));
    expect(lap?.sales).toBe(1);
    expect(lap?.revenueMicro).toBe(10_000_000n);
  });

  it("leaves an unknown dynamic id unattributed and does not match another organisation", async () => {
    const unknown = await insertPostback(t.db, org, {
      eventKey: "lead_unknown",
      type: "lead",
      dynamicId: "never-sent",
      valueMicro: null,
      params: {},
      receivedAt: at("2026-11-06T10:10:00Z"),
    });
    const result = await attributePostback(t.db, unknown.postback);
    expect(result.attributed).toBe(false);
    expect(result.postback.messageId).toBeNull();

    const foreign = await insertPostback(t.db, otherOrg, {
      eventKey: "lead_d3_other",
      type: "lead",
      dynamicId: "d3",
      valueMicro: null,
      params: {},
      receivedAt: at("2026-11-06T10:11:00Z"),
    });
    const foreignResult = await attributePostback(t.db, foreign.postback);
    expect(foreignResult.attributed).toBe(false);
    expect(foreignResult.postback.messageId).toBeNull();
  });
});

describe("listPostbacks", () => {
  beforeAll(async () => {
    const d3 = await insertPostback(t.db, org, {
      eventKey: "lead_d3",
      type: "lead",
      dynamicId: "d3",
      valueMicro: null,
      params: { type: "lead", dynamic_id: "d3", sub_id: "x" },
      receivedAt: at("2026-11-07T09:00:00Z"),
    });
    await attributePostback(t.db, d3.postback);
    const d5 = await insertPostback(t.db, org, {
      eventKey: "sale_d5",
      type: "sale",
      dynamicId: "d5",
      valueMicro: 5_000_000,
      params: { type: "sale", dynamic_id: "d5", value: "5" },
      receivedAt: at("2026-11-08T09:00:00Z"),
    });
    await attributePostback(t.db, d5.postback);
  });

  it("lists the organisation's events newest first with the campaign name", async () => {
    const page = await listPostbacks(t.db, org, { page: 1, pageSize: 10 });
    expect(page.total).toBe(5);
    expect(page.rows.map((r) => r.eventKey)).toEqual([
      "sale_d5",
      "lead_d3",
      "lead_unknown",
      "sale_d1",
      "lead_d1",
    ]);
    expect(page.rows[0]).toMatchObject({
      type: "sale",
      campaignId,
      campaignName: "Spring ES",
      valueMicro: 5_000_000n,
      params: { type: "sale", dynamic_id: "d5", value: "5" },
    });
    expect(page.rows[2]?.campaignName).toBeNull();
    const other = await listPostbacks(t.db, otherOrg, { page: 1, pageSize: 10 });
    expect(other.rows.map((r) => r.eventKey)).toEqual(["lead_d3_other"]);
  });

  it("filters by type, date range and search, and paginates", async () => {
    const sales = await listPostbacks(t.db, org, { type: "sale", page: 1, pageSize: 10 });
    expect(sales.rows.map((r) => r.eventKey)).toEqual(["sale_d5", "sale_d1"]);

    const ranged = await listPostbacks(t.db, org, {
      from: at("2026-11-07T00:00:00Z"),
      to: at("2026-11-07T23:59:59Z"),
      page: 1,
      pageSize: 10,
    });
    expect(ranged.rows.map((r) => r.eventKey)).toEqual(["lead_d3"]);

    const searched = await listPostbacks(t.db, org, { search: "D1", page: 1, pageSize: 10 });
    expect(searched.rows.map((r) => r.eventKey)).toEqual(["sale_d1", "lead_d1"]);

    const second = await listPostbacks(t.db, org, { page: 2, pageSize: 2 });
    expect(second.total).toBe(5);
    expect(second.rows.map((r) => r.eventKey)).toEqual(["lead_unknown", "sale_d1"]);
  });
});

// D4-12: every attributed conversion says when its SMS went out and whether it came the same
// UTC day or later.
describe("listPostbacks timing", () => {
  beforeAll(async () => {
    await t.db
      .update(messages)
      .set({ sentAt: at("2026-11-07T08:00:00Z") })
      .where(inArray(messages.id, [messageIds.d3 ?? "", messageIds.d5 ?? ""]));
    await t.db
      .update(messages)
      .set({ sentAt: at("2026-11-06T09:00:00Z") })
      .where(eq(messages.id, messageIds.d1 ?? ""));
  });

  it("marks same-day and late conversions and leaves unattributed ones unmarked", async () => {
    const page = await listPostbacks(t.db, org, { page: 1, pageSize: 10 });
    const byKey = Object.fromEntries(page.rows.map((r) => [r.eventKey, r]));
    expect(byKey.lead_d3).toMatchObject({
      messageSentAt: at("2026-11-07T08:00:00Z"),
      timing: "same_day",
      daysLater: 0,
    });
    expect(byKey.sale_d5).toMatchObject({
      messageSentAt: at("2026-11-07T08:00:00Z"),
      timing: "late",
      daysLater: 1,
    });
    expect(byKey.lead_unknown).toMatchObject({
      messageSentAt: null,
      timing: null,
      daysLater: null,
    });
  });

  it("filters by timing", async () => {
    const late = await listPostbacks(t.db, org, { timing: "late", page: 1, pageSize: 10 });
    expect(late.rows.map((r) => r.eventKey)).toEqual(["sale_d5"]);
    expect(late.total).toBe(1);
    const same = await listPostbacks(t.db, org, { timing: "same_day", page: 1, pageSize: 10 });
    expect(same.rows.map((r) => r.eventKey)).toEqual(["lead_d3", "sale_d1", "lead_d1"]);
    expect(same.total).toBe(3);
  });
});

describe("repeat deposits", () => {
  it("count once: a second sale on the same message adds its value but not a sale", async () => {
    const repeat = await insertPostback(t.db, org, {
      eventKey: "sale_d1_repeat",
      type: "sale",
      dynamicId: "d1",
      valueMicro: 3_000_000,
      params: { type: "deposit", dynamic_id: "d1", value: "3", event_key: "dep-2" },
      receivedAt: at("2026-11-08T12:00:00Z"),
    });
    const result = await attributePostback(t.db, repeat.postback);
    expect(result.attributed).toBe(true);
    const [lap] = await t.db.select().from(laps).where(eq(laps.id, lap1));
    expect(lap?.sales).toBe(1);
    expect(lap?.revenueMicro).toBe(13_000_000n);
  });
});

describe("conversionStats", () => {
  it("totals the campaign and breaks it down per lap, sender id and ad text", async () => {
    const stats = await conversionStats(t.db, org, campaignId);
    if (!stats) throw new Error("expected stats");
    expect(stats.campaign).toEqual({
      key: campaignId,
      label: "Spring ES",
      sent: 6,
      leads: 2,
      sales: 2,
      costMicro: 160_000,
      revenueMicro: 18_000_000,
      leadRate: 2 / 6,
      saleRate: 2 / 6,
      cplMicro: 80_000,
      cpsMicro: 80_000,
    });

    // D4-12: both sign-ups came the day of their SMS; the d5 first deposit came a day later.
    // The repeat deposit on d1 is not a sale, so it is not a late one either.
    expect(stats.timing).toEqual({ lateLeads: 0, lateSales: 1 });

    expect(stats.laps.map((l) => [l.key, l.sent, l.leads, l.sales, l.revenueMicro])).toEqual([
      [lap1, 4, 2, 1, 13_000_000],
      [lap2, 2, 0, 1, 5_000_000],
    ]);
    expect(stats.laps[0]?.label).toBe("405");

    expect(stats.senderIds).toEqual([
      {
        key: "SID1",
        label: "SID1",
        sent: 3,
        leads: 1,
        sales: 2,
        costMicro: 80_000,
        revenueMicro: 18_000_000,
        leadRate: 1 / 3,
        saleRate: 2 / 3,
        cplMicro: 80_000,
        cpsMicro: 40_000,
      },
      {
        key: "SID2",
        label: "SID2",
        sent: 3,
        leads: 1,
        sales: 0,
        costMicro: 80_000,
        revenueMicro: 0,
        leadRate: 1 / 3,
        saleRate: 0,
        cplMicro: 80_000,
        cpsMicro: null,
      },
    ]);

    expect(stats.adTexts.map((a) => [a.key, a.label, a.sent, a.leads, a.sales])).toEqual([
      [text1, "text one", 3, 2, 2],
      [text2, "text two", 2, 0, 0],
      ["", "No ad text", 1, 0, 0],
    ]);
  });

  it("returns null for a campaign of another organisation", async () => {
    await expect(conversionStats(t.db, otherOrg, campaignId)).resolves.toBeNull();
  });
});
