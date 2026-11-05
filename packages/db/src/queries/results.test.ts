import { and, count, eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  auditLog,
  campaignLinks,
  campaigns,
  clicks,
  contacts,
  laps,
  ledgerEntries,
  links,
  listMembers,
  lists,
  messages,
  routePrices,
  routes,
} from "../schema/index.js";
import { createTestDb, seedOrganisation, type TestDb } from "../test/db.js";
import { listCampaigns } from "./campaigns.js";
import { campaignResults, setLapOn } from "./results.js";

let t: TestDb;
let orgA: string;
let orgB: string;
let listId: string;
let route405: string;
let route403: string;
let campaignId: string;
let lap405: string;
let lap403: string;
let linkA: string;
let linkB: string;
const contactIds: string[] = [];

const FIRST_SEND = new Date("2026-09-14T10:00:00Z");

async function seedRoute(name: string, provider: string): Promise<string> {
  const [route] = await t.db
    .insert(routes)
    .values({ organisationId: null, provider, name, country: "ES" })
    .returning({ id: routes.id });
  if (!route) throw new Error("route insert failed");
  await t.db
    .insert(routePrices)
    .values({ routeId: route.id, country: "ES", priceMicro: 25_000n, validFrom: new Date(0) });
  return route.id;
}

async function seedLap(
  routeId: string,
  counters: {
    sent: number;
    delivered: number;
    failed: number;
    clicks: number;
    leads: number;
    sales: number;
    costMicro: bigint;
    rank: number | null;
    status: "queued" | "sending" | "done" | "cancelled";
  },
): Promise<string> {
  const [lap] = await t.db
    .insert(laps)
    .values({
      organisationId: orgA,
      campaignId,
      listId,
      routeId,
      testSize: 10,
      startedAt: FIRST_SEND,
      finishedAt: counters.status === "done" ? new Date("2026-09-14T10:30:00Z") : null,
      ...counters,
    })
    .returning({ id: laps.id });
  if (!lap) throw new Error("lap insert failed");
  return lap.id;
}

interface MessageSeed {
  lapId: string;
  routeId: string;
  status: "queued" | "sent" | "delivered" | "failed" | "expired" | "cancelled";
  linkId: string | null;
  /** Click offsets in minutes after the first send; one click row each. */
  clicksAt: number[];
}

async function seedMessage(index: number, seed: MessageSeed): Promise<string> {
  const contactId = contactIds[index];
  if (!contactId) throw new Error("not enough contacts seeded");
  const sentAt = seed.status === "queued" ? null : new Date(FIRST_SEND.getTime() + index * 60_000);
  const [message] = await t.db
    .insert(messages)
    .values({
      organisationId: orgA,
      campaignId,
      lapId: seed.lapId,
      contactId,
      e164: `+3460000${String(index).padStart(4, "0")}`,
      senderId: "LUCKY777",
      text: "Hola",
      encoding: "GSM_7BIT",
      parts: 1,
      routeId: seed.routeId,
      status: seed.status,
      linkId: seed.linkId,
      idempotencyKey: `results:${seed.lapId}:${index}`,
      sentAt,
    })
    .returning({ id: messages.id });
  if (!message) throw new Error("message insert failed");
  for (const minutes of seed.clicksAt) {
    await t.db.insert(clicks).values({
      organisationId: orgA,
      messageId: message.id,
      campaignId,
      lapId: seed.lapId,
      at: new Date(FIRST_SEND.getTime() + minutes * 60_000),
    });
  }
  return message.id;
}

beforeAll(async () => {
  t = await createTestDb();
  orgA = await seedOrganisation(t.db, "org-a");
  orgB = await seedOrganisation(t.db, "org-b");

  const [list] = await t.db
    .insert(lists)
    .values({ organisationId: orgA, name: "Roy Boy_ES", country: "ES", numbersCount: 20 })
    .returning({ id: lists.id });
  if (!list) throw new Error("list insert failed");
  listId = list.id;
  const contactRows = await t.db
    .insert(contacts)
    .values(
      Array.from({ length: 20 }, (_, i) => ({
        organisationId: orgA,
        e164: `+3460000${String(i).padStart(4, "0")}`,
        country: "ES",
      })),
    )
    .returning({ id: contacts.id });
  contactIds.push(...contactRows.map((c) => c.id));
  await t.db
    .insert(listMembers)
    .values(contactRows.map((c) => ({ organisationId: orgA, listId, contactId: c.id })));

  route405 = await seedRoute("405", "platform");
  route403 = await seedRoute("403", "smpp");

  const [campaign] = await t.db
    .insert(campaigns)
    .values({
      organisationId: orgA,
      name: "Results ES",
      country: "ES",
      timezone: "Europe/Madrid",
      status: "sending",
    })
    .returning({ id: campaigns.id });
  if (!campaign) throw new Error("campaign insert failed");
  campaignId = campaign.id;

  const linkRows = await t.db
    .insert(links)
    .values([
      { organisationId: orgA, name: "Offer A", url: "https://a.example/{{dynamic}}" },
      { organisationId: orgA, name: "Offer B", url: "https://b.example/{{dynamic}}" },
    ])
    .returning({ id: links.id });
  const [a, b] = linkRows;
  if (!a || !b) throw new Error("link insert failed");
  linkA = a.id;
  linkB = b.id;
  await t.db.insert(campaignLinks).values([
    { campaignId, linkId: linkA, organisationId: orgA },
    { campaignId, linkId: linkB, organisationId: orgA },
  ]);

  // Lap 405: 5 sent (3 delivered, 1 failed), 3 clicks, 1 lead, 1 sale; ranked 1.
  lap405 = await seedLap(route405, {
    sent: 5,
    delivered: 3,
    failed: 1,
    clicks: 3,
    leads: 1,
    sales: 1,
    costMicro: 125_000n,
    rank: 1,
    status: "done",
  });
  // Lap 403: 4 sent (2 delivered, 2 failed), 1 click, no conversions; ranked 2, still sending.
  lap403 = await seedLap(route403, {
    sent: 4,
    delivered: 2,
    failed: 2,
    clicks: 1,
    leads: 0,
    sales: 0,
    costMicro: 100_000n,
    rank: 2,
    status: "sending",
  });

  // Messages that reconcile with the lap counters above. Clicks: 3 in the first hour,
  // 1 in the third hour since the first send; 3 on link A, 1 on link B.
  const plan: MessageSeed[] = [
    { lapId: lap405, routeId: route405, status: "delivered", linkId: linkA, clicksAt: [5, 20] },
    { lapId: lap405, routeId: route405, status: "delivered", linkId: linkA, clicksAt: [150] },
    { lapId: lap405, routeId: route405, status: "delivered", linkId: linkA, clicksAt: [] },
    { lapId: lap405, routeId: route405, status: "sent", linkId: linkA, clicksAt: [] },
    { lapId: lap405, routeId: route405, status: "sent", linkId: linkB, clicksAt: [] },
    { lapId: lap405, routeId: route405, status: "failed", linkId: linkB, clicksAt: [] },
    { lapId: lap403, routeId: route403, status: "delivered", linkId: linkB, clicksAt: [40] },
    { lapId: lap403, routeId: route403, status: "delivered", linkId: linkB, clicksAt: [] },
    { lapId: lap403, routeId: route403, status: "sent", linkId: linkB, clicksAt: [] },
    { lapId: lap403, routeId: route403, status: "expired", linkId: null, clicksAt: [] },
    { lapId: lap403, routeId: route403, status: "failed", linkId: null, clicksAt: [] },
    { lapId: lap403, routeId: route403, status: "queued", linkId: null, clicksAt: [] },
  ];
  for (const [i, seed] of plan.entries()) await seedMessage(i, seed);

  // Ledger debit for the queued message so switching the lap off has something to refund.
  const [queued] = await t.db
    .select({ id: messages.id })
    .from(messages)
    .where(and(eq(messages.lapId, lap403), eq(messages.status, "queued")));
  if (!queued) throw new Error("queued message missing");
  await t.db.insert(ledgerEntries).values({
    organisationId: orgA,
    kind: "debit",
    amountMicro: -25_000n,
    referenceType: "message",
    referenceId: queued.id,
    idempotencyKey: `debit:${queued.id}`,
  });
});

afterAll(async () => {
  await t.close();
});

describe("campaignResults", () => {
  it("totals equal the sum of the lap counters and the derived rates are integer micro-EUR", async () => {
    const results = await campaignResults(t.db, orgA, campaignId);
    if (!results) throw new Error("results missing");
    expect(results.totals).toEqual({
      sent: 9,
      delivered: 5,
      failed: 3,
      clicks: 4,
      leads: 1,
      sales: 1,
      costMicro: 225_000n,
      revenueMicro: 0n,
      ctr: 4 / 9,
      deliveryRate: 5 / 9,
      failureRate: 3 / 9,
      cpcMicro: 56_250n,
      cplMicro: 225_000n,
      cpsMicro: 225_000n,
    });
    expect(results.firstSentAt).toEqual(FIRST_SEND);

    // The same numbers straight from the lap rows, the way the QA check queries them.
    const [raw] = await t.db
      .select({
        sent: sql<number>`sum(${laps.sent})`.mapWith(Number),
        clicks: sql<number>`sum(${laps.clicks})`.mapWith(Number),
        cost: sql<string>`sum(${laps.costMicro})`,
      })
      .from(laps)
      .where(eq(laps.campaignId, campaignId));
    expect(raw).toEqual({ sent: 9, clicks: 4, cost: "225000" });
  });

  it("lists the laps ranked with every SMS Edge column and the on/off state", async () => {
    const results = await campaignResults(t.db, orgA, campaignId);
    if (!results) throw new Error("results missing");
    expect(results.laps.map((l) => [l.rank, l.routeName, l.on])).toEqual([
      [1, "405", true],
      [2, "403", true],
    ]);
    const [first] = results.laps;
    expect(first).toMatchObject({
      id: lap405,
      listName: "Roy Boy_ES",
      sent: 5,
      delivered: 3,
      failed: 1,
      clicks: 3,
      leads: 1,
      sales: 1,
      costMicro: 125_000n,
      ctr: 0.6,
      cpcMicro: 41_667n,
      cplMicro: 125_000n,
      cpsMicro: 125_000n,
    });
  });

  it("breaks the messages down by route / provider and reconciles with the message table", async () => {
    const results = await campaignResults(t.db, orgA, campaignId);
    if (!results) throw new Error("results missing");
    expect(results.networks.source).toBe("route");
    expect(results.networks.rows.map((r) => [r.name, r.provider])).toEqual([
      ["405", "platform"],
      ["403", "smpp"],
    ]);
    const [r405, r403] = results.networks.rows;
    expect(r405).toMatchObject({ sent: 5, delivered: 3, failed: 1, clicks: 3, ctr: 0.6 });
    // 403: sent counts submitted messages (sent, delivered, expired), failed counts failed + expired.
    expect(r403).toMatchObject({ sent: 4, delivered: 2, failed: 2, clicks: 1, ctr: 0.25 });

    const [raw405] = await t.db
      .select({ n: count() })
      .from(messages)
      .where(
        and(
          eq(messages.routeId, route405),
          inArray(messages.status, ["sent", "delivered", "expired"]),
        ),
      );
    expect(r405?.sent).toBe(raw405?.n);
    const [rawClicks] = await t.db
      .select({ n: count() })
      .from(clicks)
      .innerJoin(messages, eq(messages.id, clicks.messageId))
      .where(eq(messages.routeId, route403));
    expect(r403?.clicks).toBe(rawClicks?.n);
  });

  it("buckets the clicks per hour since the first send and per link", async () => {
    const results = await campaignResults(t.db, orgA, campaignId);
    if (!results) throw new Error("results missing");
    expect(results.clicksPerHour).toEqual([
      { hour: 0, at: new Date("2026-09-14T10:00:00Z"), clicks: 3 },
      { hour: 2, at: new Date("2026-09-14T12:00:00Z"), clicks: 1 },
    ]);
    expect(results.clicksPerLink.map((l) => [l.name, l.sent, l.clicks, l.ctr])).toEqual([
      ["Offer A", 4, 3, 0.75],
      ["Offer B", 4, 1, 0.25],
      ["No link", 1, 0, 0],
    ]);
    const [rawClicks] = await t.db
      .select({ n: count() })
      .from(clicks)
      .where(eq(clicks.campaignId, campaignId));
    expect(results.clicksPerHour.reduce((n, h) => n + h.clicks, 0)).toBe(rawClicks?.n);
    expect(results.clicksPerLink.reduce((n, l) => n + l.clicks, 0)).toBe(rawClicks?.n);
  });

  it("is null for another organisation", async () => {
    expect(await campaignResults(t.db, orgB, campaignId)).toBeNull();
  });
});

describe("setLapOn", () => {
  it("switches a sending lap off (cancelled, queued messages refunded) and back on (queued)", async () => {
    const off = await setLapOn(t.db, orgA, { lapId: lap403, on: false, actorUserId: null });
    expect(off.status).toBe("cancelled");
    expect(off.finishedAt).toBeInstanceOf(Date);
    const [queued] = await t.db
      .select({ n: count() })
      .from(messages)
      .where(and(eq(messages.lapId, lap403), eq(messages.status, "queued")));
    expect(queued?.n).toBe(0);
    const refunds = await t.db
      .select()
      .from(ledgerEntries)
      .where(and(eq(ledgerEntries.organisationId, orgA), eq(ledgerEntries.kind, "refund")));
    expect(refunds.map((r) => r.amountMicro)).toEqual([25_000n]);

    const afterOff = await campaignResults(t.db, orgA, campaignId);
    expect(afterOff?.laps.find((l) => l.id === lap403)?.on).toBe(false);

    const on = await setLapOn(t.db, orgA, { lapId: lap403, on: true, actorUserId: null });
    expect(on.status).toBe("queued");
    expect(on.finishedAt).toBeNull();

    const audit = await t.db
      .select({ action: auditLog.action, details: auditLog.details })
      .from(auditLog)
      .where(and(eq(auditLog.targetType, "campaign"), eq(auditLog.targetId, campaignId)));
    expect(audit.map((a) => a.action)).toEqual(["lap.toggle", "lap.toggle"]);
    expect(audit[0]?.details).toMatchObject({ lapId: lap403, on: false, from: "sending" });
    expect(audit[1]?.details).toMatchObject({ lapId: lap403, on: true, from: "cancelled" });
  });

  it("refuses a finished lap and a lap of another organisation", async () => {
    await expect(
      setLapOn(t.db, orgA, { lapId: lap405, on: false, actorUserId: null }),
    ).rejects.toThrow(/finished/);
    await expect(
      setLapOn(t.db, orgB, { lapId: lap403, on: false, actorUserId: null }),
    ).rejects.toThrow(/not found/);
  });
});

describe("listCampaigns filters", () => {
  let quietId: string;

  beforeAll(async () => {
    const [quiet] = await t.db
      .insert(campaigns)
      .values({
        organisationId: orgA,
        name: "Quiet FR",
        country: "FR",
        timezone: "Europe/Paris",
        status: "draft",
        createdAt: new Date("2026-10-01T00:00:00Z"),
      })
      .returning({ id: campaigns.id });
    if (!quiet) throw new Error("campaign insert failed");
    quietId = quiet.id;
  });

  it("keeps the old signature working", async () => {
    const page = await listCampaigns(t.db, orgA, { page: 1 });
    expect(page.items.map((c) => c.name)).toEqual(["Results ES", "Quiet FR"]);
    expect(page.total).toBe(2);
  });

  it("filters by has leads, has sales and no clicks", async () => {
    const leads = await listCampaigns(t.db, orgA, { page: 1, hasLeads: true });
    expect(leads.items.map((c) => c.id)).toEqual([campaignId]);
    const sales = await listCampaigns(t.db, orgA, { page: 1, hasSales: true });
    expect(sales.items.map((c) => c.id)).toEqual([campaignId]);
    expect(sales.total).toBe(1);
    const noClicks = await listCampaigns(t.db, orgA, { page: 1, noClicks: true });
    expect(noClicks.items.map((c) => c.id)).toEqual([quietId]);
  });

  it("filters by spend above / below in micro-EUR", async () => {
    const above = await listCampaigns(t.db, orgA, { page: 1, spendMinMicro: 200_000n });
    expect(above.items.map((c) => c.id)).toEqual([campaignId]);
    const below = await listCampaigns(t.db, orgA, { page: 1, spendMaxMicro: 200_000n });
    expect(below.items.map((c) => c.id)).toEqual([quietId]);
    const band = await listCampaigns(t.db, orgA, {
      page: 1,
      spendMinMicro: 1n,
      spendMaxMicro: 225_000n,
    });
    expect(band.items.map((c) => c.id)).toEqual([campaignId]);
  });

  it("filters by the sending period, falling back to the creation date without laps", async () => {
    const september = await listCampaigns(t.db, orgA, {
      page: 1,
      from: new Date("2026-09-01T00:00:00Z"),
      to: new Date("2026-10-01T00:00:00Z"),
    });
    expect(september.items.map((c) => c.id)).toEqual([campaignId]);
    const october = await listCampaigns(t.db, orgA, {
      page: 1,
      from: new Date("2026-10-01T00:00:00Z"),
    });
    expect(october.items.map((c) => c.id)).toEqual([quietId]);
  });

  it("honours a custom page size for exports", async () => {
    const page = await listCampaigns(t.db, orgA, { page: 1, pageSize: 1 });
    expect(page.items).toHaveLength(1);
    expect(page.pageSize).toBe(1);
    expect(page.total).toBe(2);
  });
});
