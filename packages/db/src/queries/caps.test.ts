import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLog, campaigns, laps, lists, routes } from "../schema/index.js";
import { createTestDb, seedOrganisation, type TestDb } from "../test/db.js";
import { type CapsStore, createCapsStore } from "./caps.js";
import { updateSettings } from "./settings.js";

let t: TestDb;
let store: CapsStore;
let org: string;
let otherOrg: string;
let campaignId: string;
let lapId: string;

function must<T>(row: T | undefined, what: string): T {
  if (row === undefined) throw new Error(`${what} returned no row`);
  return row;
}

beforeAll(async () => {
  t = await createTestDb();
  store = createCapsStore(t.db);
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
  const routeId = must(
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
        .values({
          organisationId: org,
          name: "c",
          country: "ES",
          timezone: "Europe/Madrid",
          status: "sending",
        })
        .returning({ id: campaigns.id })
    )[0],
    "campaign",
  ).id;
  lapId = must(
    (
      await t.db
        .insert(laps)
        .values({
          organisationId: org,
          campaignId,
          listId,
          routeId,
          testSize: 600,
          status: "sending",
        })
        .returning({ id: laps.id })
    )[0],
    "lap",
  ).id;
});

afterAll(async () => {
  await t.close();
});

describe("caps store", () => {
  it("reads the daily caps from the organisation settings, unlimited by default", async () => {
    expect(await store.getDailyCaps(org)).toEqual({
      dailyMessageCap: null,
      dailySpendCapMicro: null,
    });
    await updateSettings(t.db, org, {
      lowBalanceThresholdMicro: null,
      lowBalanceEmails: [],
      dailyMessageCap: 500,
      dailySpendCapMicro: 10_000_000n,
    });
    expect(await store.getDailyCaps(org)).toEqual({
      dailyMessageCap: 500,
      dailySpendCapMicro: 10_000_000n,
    });
    expect(await store.getDailyCaps(otherOrg)).toEqual({
      dailyMessageCap: null,
      dailySpendCapMicro: null,
    });
  });

  it("reports today's usage", async () => {
    expect(await store.getDailyUsage(org, new Date("2026-11-06T00:00:00Z"))).toEqual({
      messages: 0,
      spentMicro: 0n,
    });
  });

  it("records a refusal on the lap, adding to the count", async () => {
    await store.recordLapRefusal({
      lapId,
      organisationId: org,
      refused: 60,
      reason: "daily_message_cap",
    });
    await store.recordLapRefusal({
      lapId,
      organisationId: org,
      refused: 40,
      reason: "daily_message_cap",
    });
    const [lap] = await t.db.select().from(laps).where(eq(laps.id, lapId));
    expect(lap).toMatchObject({ refused: 100, refusalReason: "daily_message_cap" });
    // Another organisation cannot touch it.
    await store.recordLapRefusal({
      lapId,
      organisationId: otherOrg,
      refused: 1,
      reason: "daily_spend_cap",
    });
    const [same] = await t.db.select().from(laps).where(eq(laps.id, lapId));
    expect(same).toMatchObject({ refused: 100, refusalReason: "daily_message_cap" });
  });

  it("pauses a sending campaign once, with an audit row, and leaves other states alone", async () => {
    expect(
      await store.pauseCampaign({
        campaignId,
        organisationId: otherOrg,
        reason: "daily_message_cap",
        details: { lapId },
      }),
    ).toBe(false);
    expect(
      await store.pauseCampaign({
        campaignId,
        organisationId: org,
        reason: "daily_message_cap",
        details: { lapId, refused: 100 },
      }),
    ).toBe(true);
    const [campaign] = await t.db.select().from(campaigns).where(eq(campaigns.id, campaignId));
    expect(campaign?.status).toBe("paused");
    expect(
      await store.pauseCampaign({
        campaignId,
        organisationId: org,
        reason: "daily_message_cap",
        details: {},
      }),
    ).toBe(false);
    const audits = await t.db.select().from(auditLog).where(eq(auditLog.action, "campaign.pause"));
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      organisationId: org,
      actorUserId: null,
      targetType: "campaign",
      targetId: campaignId,
      details: { reason: "daily_message_cap", by: "worker", lapId, refused: 100 },
    });

    await t.db.update(campaigns).set({ status: "stopped" }).where(eq(campaigns.id, campaignId));
    expect(
      await store.pauseCampaign({ campaignId, organisationId: org, reason: "x", details: {} }),
    ).toBe(false);
  });

  it("raises alerts through the alerts table", async () => {
    const result = await store.raiseAlert(org, {
      kind: "daily_message_cap",
      periodKey: "2026-11-06",
      message: "cap reached",
    });
    expect(result.created).toBe(true);
    expect(
      (
        await store.raiseAlert(org, {
          kind: "daily_message_cap",
          periodKey: "2026-11-06",
          message: "again",
        })
      ).created,
    ).toBe(false);
  });
});
