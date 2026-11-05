import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  campaigns,
  contacts,
  laps,
  ledgerEntries,
  lists,
  messages,
  organisationSettings,
  routes,
} from "../schema/index.js";
import { createTestDb, seedOrganisation, type TestDb } from "../test/db.js";
import {
  dailyUsage,
  organisationsWithLowBalanceRule,
  organisationsWithRecentSends,
  sendRate,
} from "./usage.js";

let t: TestDb;
let org: string;
let otherOrg: string;
let lapId: string;
let contactId: string;
let routeId: string;
let campaignId: string;

const NOW = new Date("2026-11-06T13:30:00Z");
const DAY_START = new Date("2026-11-06T00:00:00Z");
const HOUR = 3_600_000;

function must<T>(row: T | undefined, what: string): T {
  if (row === undefined) throw new Error(`${what} returned no row`);
  return row;
}

let seq = 0;
async function addMessage(
  createdAt: Date,
  status: "queued" | "sent" | "failed" | "cancelled" = "sent",
  organisationId = org,
): Promise<string> {
  seq += 1;
  const row = must(
    (
      await t.db
        .insert(messages)
        .values({
          organisationId,
          campaignId,
          lapId,
          contactId,
          routeId,
          e164: "+34600000000",
          senderId: "SID",
          text: "x",
          encoding: "GSM_7BIT",
          status,
          createdAt,
          idempotencyKey: `usage:${seq}`,
        })
        .returning({ id: messages.id })
    )[0],
    "message",
  );
  return row.id;
}

async function addLedger(
  createdAt: Date,
  kind: "debit" | "refund" | "deposit",
  amountMicro: bigint,
  referenceType: string,
  organisationId = org,
): Promise<void> {
  seq += 1;
  await t.db.insert(ledgerEntries).values({
    organisationId,
    kind,
    amountMicro,
    referenceType,
    referenceId: `ref-${seq}`,
    idempotencyKey: `usage-ledger:${seq}`,
    createdAt,
  });
}

beforeAll(async () => {
  t = await createTestDb();
  org = await seedOrganisation(t.db, "org-a");
  otherOrg = await seedOrganisation(t.db, "org-b");
  const listId = must(
    (
      await t.db
        .insert(lists)
        .values({ organisationId: org, name: "ES", country: "ES" })
        .returning({ id: lists.id })
    )[0],
    "list",
  ).id;
  routeId = must(
    (
      await t.db
        .insert(routes)
        .values({ provider: "fake", name: "fake-1", country: "ES" })
        .returning({ id: routes.id })
    )[0],
    "route",
  ).id;
  campaignId = must(
    (
      await t.db
        .insert(campaigns)
        .values({ organisationId: org, name: "c", country: "ES", timezone: "Europe/Madrid" })
        .returning({ id: campaigns.id })
    )[0],
    "campaign",
  ).id;
  lapId = must(
    (
      await t.db
        .insert(laps)
        .values({ organisationId: org, campaignId, listId, routeId, testSize: 10 })
        .returning({ id: laps.id })
    )[0],
    "lap",
  ).id;
  contactId = must(
    (
      await t.db
        .insert(contacts)
        .values({ organisationId: org, e164: "+34600000000", country: "ES" })
        .returning({ id: contacts.id })
    )[0],
    "contact",
  ).id;
});

afterAll(async () => {
  await t.close();
});

describe("dailyUsage", () => {
  it("is zero for an organisation without activity", async () => {
    expect(await dailyUsage(t.db, org, DAY_START)).toEqual({ messages: 0, spentMicro: 0n });
  });

  it("counts today's non-cancelled messages and the net message spend since midnight UTC", async () => {
    await addMessage(new Date("2026-11-06T01:00:00Z"), "sent");
    await addMessage(new Date("2026-11-06T02:00:00Z"), "queued");
    await addMessage(new Date("2026-11-06T03:00:00Z"), "failed");
    await addMessage(new Date("2026-11-06T04:00:00Z"), "cancelled");
    await addMessage(new Date("2026-11-05T23:59:59Z"), "sent"); // yesterday
    await addMessage(new Date("2026-11-06T05:00:00Z"), "sent", otherOrg);

    await addLedger(new Date("2026-11-06T01:00:00Z"), "debit", -25_000n, "message");
    await addLedger(new Date("2026-11-06T02:00:00Z"), "debit", -50_000n, "message");
    await addLedger(new Date("2026-11-06T03:00:00Z"), "refund", 25_000n, "message");
    await addLedger(new Date("2026-11-06T04:00:00Z"), "deposit", 1_000_000_000n, "manual");
    await addLedger(new Date("2026-11-05T23:00:00Z"), "debit", -99_000n, "message");
    await addLedger(new Date("2026-11-06T05:00:00Z"), "debit", -77_000n, "message", otherOrg);

    expect(await dailyUsage(t.db, org, DAY_START)).toEqual({ messages: 3, spentMicro: 50_000n });
    expect(await dailyUsage(t.db, otherOrg, DAY_START)).toEqual({
      messages: 1,
      spentMicro: 77_000n,
    });
  });

  it("never reports negative spend when refunds outweigh debits in the window", async () => {
    await addLedger(new Date("2026-11-06T06:00:00Z"), "refund", 500_000n, "message");
    expect((await dailyUsage(t.db, org, DAY_START)).spentMicro).toBe(0n);
  });
});

describe("sendRate", () => {
  it("separates the last hour from the seven-day hourly average before it", async () => {
    // Three in the last hour (one cancelled, not counted), the earlier ones spread over the week.
    await addMessage(new Date(NOW.getTime() - 10 * 60_000), "sent");
    await addMessage(new Date(NOW.getTime() - 20 * 60_000), "queued");
    await addMessage(new Date(NOW.getTime() - 30 * 60_000), "cancelled");
    await addMessage(new Date(NOW.getTime() - 2 * HOUR), "sent");
    await addMessage(new Date(NOW.getTime() - 6 * 24 * HOUR), "sent");
    await addMessage(new Date(NOW.getTime() - 8 * 24 * HOUR), "sent"); // older than 7 days + 1 h
    const rate = await sendRate(t.db, org, NOW);
    expect(rate.lastHour).toBe(2);
    // The week before the last hour holds the -2 h and -6 d rows above plus the four
    // non-cancelled org-a rows the dailyUsage test inserted (01:00, 02:00, 03:00 and
    // yesterday 23:59:59, all after the window start), so six messages over 168 hours.
    const windowStart = NOW.getTime() - HOUR - 7 * 24 * HOUR;
    expect(windowStart).toBeLessThan(new Date("2026-11-05T23:59:59Z").getTime());
    expect(rate.sevenDayHourlyAverage).toBeCloseTo(6 / 168, 6);
  });
});

describe("organisation lists for the scheduler", () => {
  it("names the organisations that sent in the window", async () => {
    expect(await organisationsWithRecentSends(t.db, new Date(NOW.getTime() - HOUR))).toEqual([org]);
    expect(await organisationsWithRecentSends(t.db, new Date("2026-11-06T04:30:00Z"))).toEqual(
      expect.arrayContaining([org, otherOrg]),
    );
  });

  it("names the organisations with a low balance threshold or a pending rearm", async () => {
    expect(await organisationsWithLowBalanceRule(t.db)).toEqual([]);
    await t.db
      .insert(organisationSettings)
      .values({ organisationId: org, lowBalanceThresholdMicro: 100n });
    await t.db
      .insert(organisationSettings)
      .values({ organisationId: otherOrg, lowBalanceAlertedAt: NOW });
    expect(await organisationsWithLowBalanceRule(t.db)).toEqual(
      expect.arrayContaining([org, otherOrg]),
    );
  });
});
