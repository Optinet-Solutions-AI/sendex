import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  adTexts,
  campaignSegments,
  campaigns,
  clicks,
  contacts,
  laps,
  ledgerEntries,
  links,
  listMembers,
  lists,
  messages,
  postbacks,
  routes,
  segments,
  suppressions,
} from "../schema/index.js";
import { createTestDb, seedOrganisation, type TestDb } from "../test/db.js";
import {
  apiUsage,
  assetPerformance,
  contactsUploadedByMonth,
  conversionsByMonth,
  costPerSaleByMonth,
  countryBreakdown,
  dashboardKpis,
  roiRows,
  segmentsCard,
  sendCountDistribution,
  sentByPeriod,
  topLists,
  underSentContacts,
} from "./dashboard.js";

let t: TestDb;
let org: string;
let other: string;
let campaignEs: string;
let campaignApi: string;
let route: string;
let seq = 0;

const SEP = new Date("2026-09-10T10:00:00Z");
const OCT = new Date("2026-10-12T10:00:00Z");

interface Seeded {
  contactId: string;
  messageId: string;
}

async function seedContact(
  o: string,
  country: string,
  createdAt: Date,
  listId?: string,
  bad = false,
): Promise<string> {
  seq += 1;
  const [contact] = await t.db
    .insert(contacts)
    .values({ organisationId: o, e164: `+3460${String(seq).padStart(7, "0")}`, country, createdAt })
    .returning({ id: contacts.id });
  if (!contact) throw new Error("seed failed");
  if (listId) {
    await t.db
      .insert(listMembers)
      .values({ organisationId: o, listId, contactId: contact.id, bad });
  }
  return contact.id;
}

async function seedMessage(input: {
  contactId: string;
  campaignId: string;
  lapId: string;
  at: Date;
  senderId?: string;
  text?: string;
  adTextId?: string;
  linkId?: string;
  status?: "sent" | "delivered";
  clicked?: boolean;
  bot?: boolean;
  leads?: number;
  sales?: number;
  saleValue?: bigint | null;
  costMicro?: bigint;
}): Promise<Seeded> {
  seq += 1;
  const [message] = await t.db
    .insert(messages)
    .values({
      organisationId: org,
      campaignId: input.campaignId,
      lapId: input.lapId,
      contactId: input.contactId,
      e164: `+34600${seq}`,
      senderId: input.senderId ?? "SID1",
      text: input.text ?? "hello",
      encoding: "GSM_7BIT",
      routeId: route,
      status: input.status ?? "sent",
      adTextId: input.adTextId ?? null,
      linkId: input.linkId ?? null,
      idempotencyKey: `k-${seq}`,
      sentAt: input.at,
    })
    .returning({ id: messages.id });
  if (!message) throw new Error("seed failed");
  if (input.clicked || input.bot) {
    await t.db.insert(clicks).values({
      organisationId: org,
      messageId: message.id,
      campaignId: input.campaignId,
      lapId: input.lapId,
      at: input.at,
      device: input.bot ? "bot" : "mobile",
    });
  }
  for (let i = 0; i < (input.leads ?? 0); i += 1) {
    await t.db.insert(postbacks).values({
      organisationId: org,
      eventKey: `lead-${seq}-${i}`,
      type: "lead",
      dynamicId: `d-${seq}`,
      messageId: message.id,
      campaignId: input.campaignId,
      lapId: input.lapId,
      receivedAt: new Date(input.at.getTime() + 3_600_000),
    });
  }
  for (let i = 0; i < (input.sales ?? 0); i += 1) {
    await t.db.insert(postbacks).values({
      organisationId: org,
      eventKey: `sale-${seq}-${i}`,
      type: "sale",
      dynamicId: `d-${seq}`,
      messageId: message.id,
      campaignId: input.campaignId,
      lapId: input.lapId,
      valueMicro: input.saleValue === undefined ? 50_000_000n : input.saleValue,
      receivedAt: new Date(input.at.getTime() + 7_200_000),
    });
  }
  await t.db.insert(ledgerEntries).values({
    organisationId: org,
    kind: "debit",
    amountMicro: -(input.costMicro ?? 40_000n),
    referenceType: "message",
    referenceId: message.id,
    idempotencyKey: `debit-${seq}`,
  });
  return { contactId: input.contactId, messageId: message.id };
}

beforeAll(async () => {
  t = await createTestDb();
  org = await seedOrganisation(t.db, "org-a");
  other = await seedOrganisation(t.db, "org-b");
  const [r] = await t.db
    .insert(routes)
    .values({ provider: "fake", name: "405", country: "ES" })
    .returning({ id: routes.id });
  if (!r) throw new Error("seed failed");
  route = r.id;
  const [ces] = await t.db
    .insert(campaigns)
    .values({ organisationId: org, name: "Casino ES", country: "ES", timezone: "Europe/Madrid" })
    .returning({ id: campaigns.id });
  const [capi] = await t.db
    .insert(campaigns)
    .values({
      organisationId: org,
      name: "API GB",
      country: "GB",
      timezone: "Europe/London",
      source: "api",
    })
    .returning({ id: campaigns.id });
  const [les] = await t.db
    .insert(lists)
    .values({ organisationId: org, name: "ES list", country: "ES", numbersCount: 3 })
    .returning({ id: lists.id });
  const [lgb] = await t.db
    .insert(lists)
    .values({ organisationId: org, name: "GB list", country: "GB", numbersCount: 2 })
    .returning({ id: lists.id });
  const [link] = await t.db
    .insert(links)
    .values({
      organisationId: org,
      name: "Trixino",
      url: "https://trixino.example",
      profitMicro: 80_000_000n,
    })
    .returning({ id: links.id });
  if (!ces || !capi || !les || !lgb || !link) throw new Error("seed failed");
  campaignEs = ces.id;
  campaignApi = capi.id;
  const [text] = await t.db
    .insert(adTexts)
    .values({
      organisationId: org,
      campaignId: campaignEs,
      text: "Play now {{link}}",
      encoding: "GSM_7BIT",
    })
    .returning({ id: adTexts.id });
  const [lapEs] = await t.db
    .insert(laps)
    .values({
      organisationId: org,
      campaignId: campaignEs,
      listId: les.id,
      routeId: route,
      testSize: 5,
    })
    .returning({ id: laps.id });
  const [lapApi] = await t.db
    .insert(laps)
    .values({
      organisationId: org,
      campaignId: campaignApi,
      listId: lgb.id,
      routeId: route,
      testSize: 5,
    })
    .returning({ id: laps.id });
  if (!text || !lapEs || !lapApi) throw new Error("seed failed");

  // ES: three good contacts. a: 3 sends (one clicked, one lead+sale); b: 1 send; c: never sent.
  const a = await seedContact(org, "ES", SEP, les.id);
  const b = await seedContact(org, "ES", SEP, les.id);
  await seedContact(org, "ES", OCT, les.id);
  // A bad member and an unsubscribed contact are not "good".
  await seedContact(org, "ES", OCT, les.id, true);
  const unsub = await seedContact(org, "ES", OCT, les.id);
  const [unsubRow] = await t.db.select().from(contacts).where(sql`id = ${unsub}`);
  await t.db.insert(suppressions).values({
    organisationId: org,
    e164: unsubRow?.e164 ?? "",
    reason: "unsubscribe",
    source: "manual",
  });
  const es = { campaignId: campaignEs, lapId: lapEs.id, adTextId: text.id, linkId: link.id };
  await seedMessage({
    ...es,
    contactId: a,
    at: SEP,
    clicked: true,
    leads: 1,
    sales: 1,
    status: "delivered",
  });
  await seedMessage({ ...es, contactId: a, at: OCT, bot: true });
  await seedMessage({ ...es, contactId: a, at: OCT, costMicro: 60_000n });
  await seedMessage({
    ...es,
    contactId: b,
    at: OCT,
    clicked: true,
    senderId: "SID2",
    text: "Other text",
  });

  // GB through the API: two contacts, one message each, one with a sale without a value.
  const g1 = await seedContact(org, "GB", OCT, lgb.id);
  const g2 = await seedContact(org, "GB", OCT, lgb.id);
  const gb = { campaignId: campaignApi, lapId: lapApi.id, linkId: link.id };
  await seedMessage({
    ...gb,
    contactId: g1,
    at: OCT,
    clicked: true,
    sales: 1,
    saleValue: null,
    costMicro: 38_000n,
  });
  await seedMessage({ ...gb, contactId: g2, at: OCT, bot: true, costMicro: 38_000n });

  // A segment used by the ES campaign.
  const [segment] = await t.db
    .insert(segments)
    .values({
      organisationId: org,
      name: "ES clickers",
      definition: { id: "g1", op: "and", rules: [] },
      summary: "Spain contacts with clicks",
    })
    .returning({ id: segments.id });
  if (!segment) throw new Error("seed failed");
  await t.db.insert(campaignSegments).values({
    organisationId: org,
    campaignId: campaignEs,
    segmentId: segment.id,
  });

  // Noise in another organisation.
  await seedContact(other, "ES", SEP);
});

afterAll(async () => {
  await t.close();
});

import { sql } from "drizzle-orm";

describe("dashboardKpis", () => {
  it("counts contacts, sends, clicks, spend, leads, sales and the blended cost per sale", async () => {
    const k = await dashboardKpis(t.db, org);
    expect(k).toEqual({
      contacts: 7,
      sent: 6,
      clicks: 3,
      spendMicro: 256_000n,
      leads: 1,
      sales: 2,
      blendedCpsMicro: 128_000n,
    });
  });

  it("applies the window and the countries", async () => {
    const sep = await dashboardKpis(t.db, org, {
      from: new Date("2026-09-01T00:00:00Z"),
      to: new Date("2026-10-01T00:00:00Z"),
    });
    expect(sep.sent).toBe(1);
    expect(sep.contacts).toBe(2);
    const gb = await dashboardKpis(t.db, org, { countries: ["gb"] });
    expect(gb).toMatchObject({ contacts: 2, sent: 2, clicks: 1, sales: 1, spendMicro: 76_000n });
    expect((await dashboardKpis(t.db, other)).sent).toBe(0);
  });
});

describe("overview series", () => {
  it("gives contacts uploaded and messages sent per period and country", async () => {
    expect(await contactsUploadedByMonth(t.db, org)).toEqual([
      { period: "2026-09", key: "ES", value: 2 },
      { period: "2026-10", key: "ES", value: 3 },
      { period: "2026-10", key: "GB", value: 2 },
    ]);
    expect(await sentByPeriod(t.db, org)).toEqual([
      { period: "2026-09", key: "ES", value: 1 },
      { period: "2026-10", key: "ES", value: 3 },
      { period: "2026-10", key: "GB", value: 2 },
    ]);
    const weeks = await sentByPeriod(t.db, org, {}, "week");
    expect(weeks.map((w) => w.period)).toEqual(["2026-09-07", "2026-10-12", "2026-10-12"]);
  });
});

describe("roi", () => {
  it("gives cost, clicks, leads, sales and revenue per country, link, list and month", async () => {
    const rows = await roiRows(t.db, org);
    const esOct = rows.find((r) => r.country === "ES" && r.month === "2026-10");
    expect(esOct).toEqual({
      country: "ES",
      link: "Trixino",
      list: "ES list",
      month: "2026-10",
      cost: 140_000n,
      clicks: 1,
      leads: 0,
      sales: 0,
      revenue: 0n,
    });
    const gb = rows.find((r) => r.country === "GB");
    // A sale without a value takes the offer's profit per sale.
    expect(gb?.revenue).toBe(80_000_000n);
    expect(rows.find((r) => r.month === "2026-09")?.revenue).toBe(50_000_000n);
  });

  it("gives cost and sales per month, account-wide", async () => {
    expect(await costPerSaleByMonth(t.db, org)).toEqual([
      { month: "2026-09", cost: 40_000n, sales: 1 },
      { month: "2026-10", cost: 216_000n, sales: 1 },
    ]);
  });
});

describe("countries", () => {
  it("breaks every country down with contacts, sends, conversions and uniques", async () => {
    const rows = await countryBreakdown(t.db, org);
    expect(rows.map((r) => r.country)).toEqual(["ES", "GB"]);
    expect(rows[0]).toMatchObject({
      contacts: 5,
      sent: 4,
      clicks: 2,
      leads: 1,
      sales: 1,
      costMicro: 180_000n,
      uniqueSignups: 1,
      uniqueBuyers: 1,
    });
    expect(rows[0]?.lastSentAt).toEqual(OCT);
    expect(rows[1]).toMatchObject({ contacts: 2, sent: 2, uniqueBuyers: 1 });
  });

  it("counts first signups and buyers per month", async () => {
    expect(await conversionsByMonth(t.db, org)).toEqual({
      signups: [{ period: "2026-09", key: "ES", value: 1 }],
      buyers: [
        { period: "2026-09", key: "ES", value: 1 },
        { period: "2026-10", key: "GB", value: 1 },
      ],
    });
  });
});

describe("contacts tab", () => {
  it("lists the biggest lists and the segments with their last use", async () => {
    const lists = await topLists(t.db, org, { page: 1 });
    expect(lists.total).toBe(2);
    expect(lists.rows.map((r) => [r.name, r.contacts])).toEqual([
      ["ES list", 3],
      ["GB list", 2],
    ]);
    const segs = await segmentsCard(t.db, org);
    expect(segs).toHaveLength(1);
    expect(segs[0]).toMatchObject({ name: "ES clickers", summary: "Spain contacts with clicks" });
    expect(segs[0]?.lastUsedAt).toBeInstanceOf(Date);
  });

  it("buckets good contacts by send count with the clicks of their messages", async () => {
    const rows = await sendCountDistribution(t.db, org);
    expect(rows).toEqual([
      { bucket: "0", country: "ES", contacts: 1, sent: 0, clicks: 0 },
      { bucket: "1–2", country: "ES", contacts: 1, sent: 1, clicks: 1 },
      { bucket: "1–2", country: "GB", contacts: 2, sent: 2, clicks: 1 },
      { bucket: "3–5", country: "ES", contacts: 1, sent: 3, clicks: 1 },
    ]);
  });

  it("counts good contacts sent fewer than the threshold", async () => {
    expect(await underSentContacts(t.db, org, { threshold: 3 })).toEqual([
      { country: "ES", good: 3, under: 2 },
      { country: "GB", good: 2, under: 2 },
    ]);
    expect(await underSentContacts(t.db, org, { threshold: 1, countries: ["ES"] })).toEqual([
      { country: "ES", good: 3, under: 1 },
    ]);
  });
});

describe("assets", () => {
  it("ranks texts, offers and sender ids by sent with their counters", async () => {
    const texts = await assetPerformance(t.db, org, { kind: "text" });
    expect(texts.total).toBe(3);
    expect(texts.rows[0]).toMatchObject({
      label: "hello",
      sent: 3,
      delivered: 1,
      clicks: 1,
    });
    const offers = await assetPerformance(t.db, org, { kind: "offer" });
    expect(offers.rows.map((r) => [r.label, r.sent])).toEqual([["Trixino", 6]]);
    expect(offers.rows[0]?.sublabel).toBe("https://trixino.example");
    const sids = await assetPerformance(t.db, org, { kind: "sid", search: "sid2" });
    expect(sids.rows.map((r) => [r.label, r.sent, r.clicks])).toEqual([["SID2", 1, 1]]);
  });
});

describe("apiUsage", () => {
  it("covers only campaigns created through the API", async () => {
    const usage = await apiUsage(t.db, org);
    expect(usage.kpis).toEqual({ sent: 2, previews: 1, clicks: 1, spendMicro: 76_000n });
    expect(usage.countries).toHaveLength(1);
    expect(usage.countries[0]).toMatchObject({ country: "GB", sent: 2, previews: 1, sales: 1 });
    expect(usage.perCountryByMonth).toEqual([{ period: "2026-10", key: "GB", value: 2 }]);
    expect(usage.log).toHaveLength(2);
    expect(usage.log[0]).toMatchObject({ from: "SID1", country: "GB", costMicro: 38_000n });
    expect(usage.log.every((l) => l.text === "hello")).toBe(true);
  });
});
