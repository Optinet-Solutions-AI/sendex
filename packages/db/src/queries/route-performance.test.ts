import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  campaigns,
  clicks,
  contacts,
  laps,
  ledgerEntries,
  lists,
  messages,
  routePrices,
  routes,
} from "../schema/index.js";
import { createTestDb, seedOrganisation, type TestDb } from "../test/db.js";
import { routePerformance } from "./route-performance.js";

let t: TestDb;
let orgA: string;
let orgB: string;
let r405: string;
let r403: string;

const NOW = new Date("2026-11-07T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

async function seedRoute(name: string): Promise<string> {
  const [route] = await t.db
    .insert(routes)
    .values({ organisationId: null, provider: "fake", name, country: "ES" })
    .returning({ id: routes.id });
  if (!route) throw new Error("route insert failed");
  await t.db
    .insert(routePrices)
    .values({ routeId: route.id, country: "ES", priceMicro: 25_000n, validFrom: new Date(0) });
  return route.id;
}

/** `n` sent messages on a route for an organisation, `clicked` of them clicked, at `at`. */
async function seedSends(
  org: string,
  routeId: string,
  n: number,
  clicked: number,
  at: Date,
): Promise<void> {
  const [campaign] = await t.db
    .insert(campaigns)
    .values({ organisationId: org, name: "c", country: "ES", timezone: "Europe/Madrid" })
    .returning({ id: campaigns.id });
  const [list] = await t.db
    .insert(lists)
    .values({ organisationId: org, name: "l", country: "ES" })
    .returning({ id: lists.id });
  if (!campaign || !list) throw new Error("seed failed");
  const [lap] = await t.db
    .insert(laps)
    .values({ organisationId: org, campaignId: campaign.id, listId: list.id, routeId, testSize: n })
    .returning({ id: laps.id });
  if (!lap) throw new Error("seed failed");
  for (let i = 0; i < n; i += 1) {
    const [contact] = await t.db
      .insert(contacts)
      .values({
        organisationId: org,
        e164: `+34${String(Date.now() + i).slice(-9)}${i}`,
        country: "ES",
      })
      .returning({ id: contacts.id });
    if (!contact) throw new Error("seed failed");
    const [message] = await t.db
      .insert(messages)
      .values({
        organisationId: org,
        campaignId: campaign.id,
        lapId: lap.id,
        contactId: contact.id,
        e164: contact.id,
        senderId: "SID",
        text: "hi",
        encoding: "GSM_7BIT",
        parts: 1,
        routeId,
        status: "sent",
        idempotencyKey: `perf:${lap.id}:${i}`,
        createdAt: at,
        sentAt: at,
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
    if (i < clicked) {
      await t.db.insert(clicks).values({
        organisationId: org,
        messageId: message.id,
        campaignId: campaign.id,
        lapId: lap.id,
        at,
      });
    }
  }
}

beforeAll(async () => {
  t = await createTestDb();
  orgA = await seedOrganisation(t.db, "org-a");
  orgB = await seedOrganisation(t.db, "org-b");
  r405 = await seedRoute("405");
  r403 = await seedRoute("403");
  // Today: org A sent 10 on 405 (2 clicks) and 10 on 403 (1 click); org B sent 20 on 403 (6 clicks).
  await seedSends(orgA, r405, 10, 2, hoursAgo(2));
  await seedSends(orgA, r403, 10, 1, hoursAgo(3));
  await seedSends(orgB, r403, 20, 6, hoursAgo(4));
  // Ten days ago: org A sent 10 more on 403 with 5 clicks (counts in the month, not the week).
  await seedSends(orgA, r403, 10, 5, hoursAgo(10 * 24));
});

afterAll(async () => {
  await t.close();
});

describe("routePerformance", () => {
  it("account statistics are the organisation's own numbers per period", async () => {
    const perf = await routePerformance(t.db, orgA, "es", NOW);
    expect(perf.country).toBe("ES");
    const daily = new Map(perf.account.daily.map((r) => [r.name, r]));
    expect(daily.get("405")).toMatchObject({
      sent: 10,
      clicks: 2,
      ctr: 0.2,
      costMicro: 250_000n,
      cpcMicro: 125_000n,
      priceMicro: 25_000n,
    });
    expect(daily.get("403")).toMatchObject({ sent: 10, clicks: 1, costMicro: 250_000n });
    const monthly = new Map(perf.account.monthly.map((r) => [r.name, r]));
    expect(monthly.get("403")).toMatchObject({ sent: 20, clicks: 6, costMicro: 500_000n });
    expect(perf.account.weekly.find((r) => r.name === "403")).toMatchObject({ sent: 10 });
  });

  it("platform ranks pool every organisation's traffic on platform routes, as ranks only", async () => {
    const perf = await routePerformance(t.db, orgA, "ES", NOW);
    // Daily across both organisations: 403 has 30 sent / 7 clicks (23%), 405 has 10 / 2 (20%).
    const daily = new Map(perf.platform.daily.map((r) => [r.name, r]));
    expect(daily.get("403")).toMatchObject({ ctrRank: 1, cpcRank: 1, overallRank: 1 });
    expect(daily.get("405")).toMatchObject({ ctrRank: 2, cpcRank: 2, overallRank: 2 });
    expect(Object.keys(daily.get("403") ?? {})).not.toContain("sent");
    // Org B sees the same ranks though it never used 405 itself.
    const forB = await routePerformance(t.db, orgB, "ES", NOW);
    expect(forB.platform.daily.find((r) => r.name === "405")?.overallRank).toBe(2);
    expect(forB.account.daily.find((r) => r.name === "405")).toMatchObject({ sent: 0, clicks: 0 });
  });

  it("a period with no traffic leaves every route unranked", async () => {
    const perf = await routePerformance(t.db, orgA, "ES", new Date("2030-01-01T00:00:00Z"));
    expect(perf.platform.daily.every((r) => r.overallRank === null)).toBe(true);
    expect(perf.account.daily.every((r) => r.sent === 0 && r.cpcMicro === null)).toBe(true);
  });
});
