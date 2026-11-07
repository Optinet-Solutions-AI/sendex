import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  campaigns,
  clicks,
  contacts,
  laps,
  ledgerEntries,
  lists,
  messages,
  postbacks,
  routes,
  users,
} from "../schema/index.js";
import { createTestDb, seedOrganisation, type TestDb } from "../test/db.js";
import { sendCalendar, sendCalendarDay, sendLog } from "./send-log.js";

let t: TestDb;
let org: string;
let other: string;
let routeA: string;
let routeB: string;
let campaignEs: string;
let campaignGb: string;
let listEs: string;
let listGb: string;

const NOV_6 = new Date("2026-11-06T10:00:00Z");
const NOV_7 = new Date("2026-11-07T09:00:00Z");
let seq = 0;

async function seedMessage(input: {
  org: string;
  campaignId: string;
  lapId: string;
  routeId: string;
  country: string;
  at: Date;
  status?: "sent" | "delivered" | "failed" | "queued";
  clicked?: boolean;
  leads?: number;
  sales?: number;
  costMicro?: bigint;
}): Promise<string> {
  seq += 1;
  const [contact] = await t.db
    .insert(contacts)
    .values({
      organisationId: input.org,
      e164: `+34600${String(seq).padStart(6, "0")}`,
      country: input.country,
    })
    .returning({ id: contacts.id });
  if (!contact) throw new Error("seed failed");
  const [message] = await t.db
    .insert(messages)
    .values({
      organisationId: input.org,
      campaignId: input.campaignId,
      lapId: input.lapId,
      contactId: contact.id,
      e164: `+34600${String(seq).padStart(6, "0")}`,
      senderId: "SID",
      text: "hi",
      encoding: "GSM_7BIT",
      routeId: input.routeId,
      status: input.status ?? "sent",
      idempotencyKey: `k-${seq}`,
      sentAt: input.at,
    })
    .returning({ id: messages.id });
  if (!message) throw new Error("seed failed");
  if (input.clicked) {
    await t.db.insert(clicks).values({
      organisationId: input.org,
      messageId: message.id,
      campaignId: input.campaignId,
      lapId: input.lapId,
      at: new Date(input.at.getTime() + 60_000),
    });
  }
  for (let i = 0; i < (input.leads ?? 0); i += 1) {
    await t.db.insert(postbacks).values({
      organisationId: input.org,
      eventKey: `lead-${seq}-${i}`,
      type: "lead",
      dynamicId: `d-${seq}`,
      messageId: message.id,
      campaignId: input.campaignId,
      lapId: input.lapId,
      // A conversion three days later still counts on the send day.
      receivedAt: new Date(input.at.getTime() + 3 * 86_400_000),
    });
  }
  for (let i = 0; i < (input.sales ?? 0); i += 1) {
    await t.db.insert(postbacks).values({
      organisationId: input.org,
      eventKey: `sale-${seq}-${i}`,
      type: "sale",
      dynamicId: `d-${seq}`,
      messageId: message.id,
      campaignId: input.campaignId,
      lapId: input.lapId,
      valueMicro: 50_000_000n,
    });
  }
  await t.db.insert(ledgerEntries).values({
    organisationId: input.org,
    kind: "debit",
    amountMicro: -(input.costMicro ?? 40_000n),
    referenceType: "message",
    referenceId: message.id,
    idempotencyKey: `debit-${seq}`,
  });
  return message.id;
}

async function seedLap(org: string, campaignId: string, listId: string, routeId: string) {
  const [lap] = await t.db
    .insert(laps)
    .values({ organisationId: org, campaignId, listId, routeId, testSize: 10, status: "done" })
    .returning({ id: laps.id });
  if (!lap) throw new Error("seed failed");
  return lap.id;
}

beforeAll(async () => {
  t = await createTestDb();
  org = await seedOrganisation(t.db, "org-a");
  other = await seedOrganisation(t.db, "org-b");
  const [user] = await t.db
    .insert(users)
    .values({ clerkUserId: "user_emily", email: "emily@example.com", name: "emily" })
    .returning({ id: users.id });
  const [ra] = await t.db
    .insert(routes)
    .values({ provider: "fake", name: "405", country: "ES" })
    .returning({ id: routes.id });
  const [rb] = await t.db
    .insert(routes)
    .values({ provider: "fake", name: "403", country: "GB" })
    .returning({ id: routes.id });
  if (!ra || !rb || !user) throw new Error("seed failed");
  routeA = ra.id;
  routeB = rb.id;
  const [ces] = await t.db
    .insert(campaigns)
    .values({
      organisationId: org,
      name: "Casino ES",
      country: "ES",
      timezone: "Europe/Madrid",
      createdBy: user.id,
    })
    .returning({ id: campaigns.id });
  const [cgb] = await t.db
    .insert(campaigns)
    .values({ organisationId: org, name: "Bingo GB", country: "GB", timezone: "Europe/London" })
    .returning({ id: campaigns.id });
  const [les] = await t.db
    .insert(lists)
    .values({ organisationId: org, name: "ES list", country: "ES" })
    .returning({ id: lists.id });
  const [lgb] = await t.db
    .insert(lists)
    .values({ organisationId: org, name: "GB list", country: "GB" })
    .returning({ id: lists.id });
  if (!ces || !cgb || !les || !lgb) throw new Error("seed failed");
  campaignEs = ces.id;
  campaignGb = cgb.id;
  listEs = les.id;
  listGb = lgb.id;
  const lapEs = await seedLap(org, campaignEs, listEs, routeA);
  const lapEs403 = await seedLap(org, campaignEs, listEs, routeB);
  const lapGb = await seedLap(org, campaignGb, listGb, routeB);

  // Nov 6, ES, route 405: 3 sent, 2 clicked, 1 lead, 1 sale; one failed and one queued are not sent.
  const es = { org, campaignId: campaignEs, lapId: lapEs, routeId: routeA, country: "ES" };
  await seedMessage({ ...es, at: NOV_6, clicked: true, leads: 1, sales: 1 });
  await seedMessage({ ...es, at: NOV_6, clicked: true });
  await seedMessage({ ...es, at: NOV_6, status: "delivered" });
  await seedMessage({ ...es, at: NOV_6, status: "failed" });
  await seedMessage({ ...es, at: NOV_6, status: "queued" });
  // Nov 6, ES, route 403: 1 sent, no clicks.
  await seedMessage({ ...es, lapId: lapEs403, routeId: routeB, at: NOV_6, costMicro: 30_000n });
  // Nov 7, GB: 2 sent, 1 clicked.
  const gb = { org, campaignId: campaignGb, lapId: lapGb, routeId: routeB, country: "GB" };
  await seedMessage({ ...gb, at: NOV_7, clicked: true, costMicro: 38_000n });
  await seedMessage({ ...gb, at: NOV_7, costMicro: 38_000n });

  // Another organisation's sends never show.
  const [co] = await t.db
    .insert(campaigns)
    .values({ organisationId: other, name: "other", country: "ES", timezone: "Europe/Madrid" })
    .returning({ id: campaigns.id });
  const [lo] = await t.db
    .insert(lists)
    .values({ organisationId: other, name: "other", country: "ES" })
    .returning({ id: lists.id });
  if (!co || !lo) throw new Error("seed failed");
  const lapOther = await seedLap(other, co.id, lo.id, routeA);
  await seedMessage({
    org: other,
    campaignId: co.id,
    lapId: lapOther,
    routeId: routeA,
    country: "ES",
    at: NOV_6,
    clicked: true,
  });
});

afterAll(async () => {
  await t.close();
});

const WINDOW = { from: new Date("2026-11-01T00:00:00Z"), to: new Date("2026-12-01T00:00:00Z") };

describe("sendLog", () => {
  it("groups submitted messages by day, campaign, country, list and route, newest day first", async () => {
    const page = await sendLog(t.db, org, { ...WINDOW, page: 1, pageSize: 25 });
    expect(page.total).toBe(3);
    expect(page.rows.map((r) => [r.day, r.campaignName, r.country, r.routeName, r.sent])).toEqual([
      ["2026-11-07", "Bingo GB", "GB", "403", 2],
      ["2026-11-06", "Casino ES", "ES", "405", 3],
      ["2026-11-06", "Casino ES", "ES", "403", 1],
    ]);
    const es405 = page.rows[1];
    expect(es405?.listName).toBe("ES list");
    expect(es405?.clicks).toBe(2);
    expect(es405?.leads).toBe(1);
    expect(es405?.sales).toBe(1);
    expect(es405?.spendMicro).toBe(120_000n);
    expect(es405?.ctr).toBeCloseTo(2 / 3, 6);
    expect(es405?.cpcMicro).toBe(60_000n);
    expect(page.rows[2]?.cpcMicro).toBeNull();
  });

  it("totals the whole filtered log, not just the page", async () => {
    const page = await sendLog(t.db, org, { ...WINDOW, page: 2, pageSize: 2 });
    expect(page.rows).toHaveLength(1);
    expect(page.total).toBe(3);
    expect(page.kpis).toEqual({
      sent: 6,
      clicks: 3,
      ctr: 0.5,
      spendMicro: 226_000n,
      cpcMicro: 75_333n,
      leads: 1,
      sales: 1,
    });
  });

  it("filters by country and by period", async () => {
    const gb = await sendLog(t.db, org, { ...WINDOW, countries: ["gb"], page: 1, pageSize: 25 });
    expect(gb.rows.map((r) => r.country)).toEqual(["GB"]);
    expect(gb.kpis.sent).toBe(2);
    const nov6 = await sendLog(t.db, org, {
      from: new Date("2026-11-06T00:00:00Z"),
      to: new Date("2026-11-07T00:00:00Z"),
      page: 1,
      pageSize: 25,
    });
    expect(nov6.rows.every((r) => r.day === "2026-11-06")).toBe(true);
    expect(nov6.kpis.sent).toBe(4);
  });

  it("is empty for an organisation without sends in the window", async () => {
    const page = await sendLog(t.db, other, {
      from: new Date("2027-01-01T00:00:00Z"),
      to: new Date("2027-02-01T00:00:00Z"),
      page: 1,
      pageSize: 25,
    });
    expect(page.rows).toEqual([]);
    expect(page.total).toBe(0);
    expect(page.kpis.cpcMicro).toBeNull();
  });
});

describe("sendCalendar", () => {
  it("gives sends, clicks and campaigns per day and country", async () => {
    const stats = await sendCalendar(t.db, org, WINDOW);
    expect(stats).toEqual([
      { day: "2026-11-06", country: "ES", sent: 4, clicks: 2, campaigns: 1 },
      { day: "2026-11-07", country: "GB", sent: 2, clicks: 1, campaigns: 1 },
    ]);
  });
});

describe("sendCalendarDay", () => {
  it("lists the campaigns of one country on one day with the creator's account", async () => {
    const rows = await sendCalendarDay(t.db, org, { day: "2026-11-06", country: "ES" });
    expect(rows).toEqual([
      {
        campaignId: campaignEs,
        campaignName: "Casino ES",
        account: "emily",
        sent: 4,
        clicks: 2,
        ctr: 0.5,
        leads: 1,
        sales: 1,
      },
    ]);
    expect(await sendCalendarDay(t.db, org, { day: "2026-11-06", country: "GB" })).toEqual([]);
    expect(await sendCalendarDay(t.db, org, { day: "bad", country: "GB" })).toEqual([]);
  });
});
