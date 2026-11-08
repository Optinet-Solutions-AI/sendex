import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  campaigns,
  clicks,
  contacts,
  laps,
  ledgerEntries,
  listMembers,
  lists,
  messages,
  postbacks,
  routes,
  suppressions,
} from "../schema/index.js";
import { createTestDb, seedOrganisation, type TestDb } from "../test/db.js";
import {
  listAnalytics,
  listCampaignsForList,
  listKpis,
  listLookupBreakdown,
} from "./list-details.js";
import { listMembersPage } from "./lists.js";

let t: TestDb;
let org: string;
let listId: string;
let campaignId: string;

const AT = new Date("2026-11-07T09:00:00Z");

beforeAll(async () => {
  t = await createTestDb();
  org = await seedOrganisation(t.db, "org-a");
  const [list] = await t.db
    .insert(lists)
    .values({ organisationId: org, name: "Roy Boy_ES_Batch2", country: "ES" })
    .returning({ id: lists.id });
  const [campaign] = await t.db
    .insert(campaigns)
    .values({
      organisationId: org,
      name: "ES casino",
      country: "ES",
      timezone: "Europe/Madrid",
      status: "sending",
    })
    .returning({ id: campaigns.id });
  const [route] = await t.db
    .insert(routes)
    .values({ provider: "fake", name: "405", country: "ES" })
    .returning({ id: routes.id });
  if (!list || !campaign || !route) throw new Error("seed failed");
  listId = list.id;
  campaignId = campaign.id;

  const numbers = ["+34622000001", "+34622000002", "+34912345678"];
  const contactIds: string[] = [];
  for (const [i, e164] of numbers.entries()) {
    const [contact] = await t.db
      .insert(contacts)
      .values({ organisationId: org, e164, country: "ES" })
      .returning({ id: contacts.id });
    if (!contact) throw new Error("seed failed");
    contactIds.push(contact.id);
    await t.db.insert(listMembers).values({
      organisationId: org,
      listId,
      contactId: contact.id,
      bad: i === 2,
      badReason: i === 2 ? "landline" : null,
      sentAt: i < 2 ? AT : null,
    });
  }
  await t.db.insert(suppressions).values({
    organisationId: org,
    e164: "+34622000002",
    reason: "unsubscribed",
    source: "test",
  });
  const [lap] = await t.db
    .insert(laps)
    .values({
      organisationId: org,
      campaignId,
      listId,
      routeId: route.id,
      testSize: 2,
      status: "done",
      sent: 2,
      clicks: 1,
      costMicro: 50_000n,
      startedAt: AT,
      finishedAt: new Date(AT.getTime() + 60_000),
    })
    .returning({ id: laps.id });
  if (!lap) throw new Error("seed failed");
  for (const i of [0, 1]) {
    const contactId = contactIds[i];
    if (!contactId) throw new Error("seed failed");
    const [message] = await t.db
      .insert(messages)
      .values({
        organisationId: org,
        campaignId,
        lapId: lap.id,
        contactId,
        e164: numbers[i] ?? "",
        senderId: "SID",
        text: "hi",
        encoding: "GSM_7BIT",
        parts: 1,
        routeId: route.id,
        status: "delivered",
        idempotencyKey: `ld:${i}`,
        sentAt: AT,
      })
      .returning({ id: messages.id });
    if (!message) throw new Error("seed failed");
    await t.db.insert(ledgerEntries).values({
      organisationId: org,
      kind: "debit",
      amountMicro: -25_000n,
      referenceType: "message",
      referenceId: message.id,
      idempotencyKey: `debit:${message.id}`,
    });
    if (i === 0) {
      await t.db.insert(clicks).values({
        organisationId: org,
        messageId: message.id,
        campaignId,
        lapId: lap.id,
        at: AT,
        device: "mobile",
      });
      await t.db.insert(postbacks).values({
        organisationId: org,
        eventKey: "evt-1",
        type: "lead",
        dynamicId: "dyn-1",
        messageId: message.id,
        campaignId,
        lapId: lap.id,
      });
      // A first deposit and a repeat deposit: one sale (FTD), both values in revenue.
      await t.db.insert(postbacks).values([
        {
          organisationId: org,
          eventKey: "evt-2",
          type: "sale",
          dynamicId: "dyn-1",
          messageId: message.id,
          campaignId,
          lapId: lap.id,
          valueMicro: 10_000_000n,
        },
        {
          organisationId: org,
          eventKey: "evt-3",
          type: "sale",
          dynamicId: "dyn-1",
          messageId: message.id,
          campaignId,
          lapId: lap.id,
          valueMicro: 4_000_000n,
        },
      ]);
    }
  }
});

afterAll(async () => {
  await t.close();
});

describe("list details", () => {
  it("KPI tiles: total, good, bad, sent and clicks from the laps", async () => {
    expect(await listKpis(t.db, org, listId)).toEqual({
      total: 3,
      good: 2,
      bad: 1,
      cached: 0,
      sent: 2,
      clicks: 1,
      ctr: 0.5,
    });
  });

  it("analytics groups members by country and by the device that clicked", async () => {
    const whole = await listAnalytics(t.db, org, listId, []);
    expect(whole).toEqual([
      {
        keys: [],
        audience: 3,
        sent: 2,
        clicks: 1,
        ctr: 0.5,
        leads: 1,
        sales: 1,
        costMicro: 50_000n,
        revenueMicro: 14_000_000n,
      },
    ]);
    const byCountry = await listAnalytics(t.db, org, listId, ["country"]);
    expect(byCountry).toHaveLength(1);
    expect(byCountry[0]).toMatchObject({ keys: ["ES"], audience: 3 });
    const byDevice = await listAnalytics(t.db, org, listId, ["device", "country"]);
    expect(byDevice.map((r) => [r.keys, r.audience, r.clicks])).toEqual([
      [["unknown", "ES"], 2, 0],
      [["mobile", "ES"], 1, 1],
    ]);
  });

  it("lists the campaigns that drew on the list", async () => {
    const rows = await listCampaignsForList(t.db, org, listId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: campaignId,
      name: "ES casino",
      laps: 1,
      sent: 2,
      clicks: 1,
      ctr: 0.5,
      costMicro: 50_000n,
    });
    expect(rows[0]?.firstLapAt).toEqual(AT);
  });

  it("the lookup breakdown counts per country: good, bad, blacklisted, clickers, sent, clicks", async () => {
    const rows = await listLookupBreakdown(t.db, org, listId);
    expect(rows).toEqual([
      {
        country: "ES",
        total: 3,
        good: 2,
        bad: 1,
        blacklisted: 1,
        clickers: 1,
        sent: 2,
        clicks: 1,
        ctr: 0.5,
        hlr: 0,
        mnp: 0,
        unresolved: 2,
        localOnly: 0,
        checking: 0,
        cached: 0,
      },
    ]);
  });

  it("the members page searches by number and filters by status", async () => {
    const bad = await listMembersPage(t.db, org, listId, { page: 1, pageSize: 25, status: "bad" });
    expect(bad.total).toBe(1);
    expect(bad.rows[0]).toMatchObject({ e164: "+34912345678", country: "ES", bad: true });
    const good = await listMembersPage(t.db, org, listId, {
      page: 1,
      pageSize: 25,
      status: "good",
    });
    expect(good.total).toBe(2);
    const search = await listMembersPage(t.db, org, listId, {
      page: 1,
      pageSize: 25,
      search: "62200000 2",
    });
    expect(search.rows.map((r) => r.e164)).toEqual(["+34622000002"]);
    expect(search.rows[0]?.createdAt).toBeInstanceOf(Date);
  });
});
