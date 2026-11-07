import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  auditLog,
  campaignLists,
  campaigns,
  contacts,
  laps,
  listMembers,
  lists,
  routes,
} from "../schema/index.js";
import { createTestDb, seedOrganisation, type TestDb } from "../test/db.js";
import { createAutosenderStore } from "./autosender.js";

let t: TestDb;
let org: string;
let campaignId: string;
let listId: string;
let routeId: string;
let testLapId: string;

beforeAll(async () => {
  t = await createTestDb();
  org = await seedOrganisation(t.db, "org-a");
  const [campaign] = await t.db
    .insert(campaigns)
    .values({
      organisationId: org,
      name: "auto",
      country: "ES",
      timezone: "Europe/Madrid",
      status: "sending",
      testSize: 10,
      autosender: true,
      autosenderMeasureMinutes: 30,
    })
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
  await t.db.insert(campaignLists).values({ campaignId, listId, organisationId: org });
  for (let i = 0; i < 3; i += 1) {
    const [contact] = await t.db
      .insert(contacts)
      .values({ organisationId: org, e164: `+3460000000${i}`, country: "ES" })
      .returning({ id: contacts.id });
    if (!contact) throw new Error("seed failed");
    await t.db.insert(listMembers).values({
      organisationId: org,
      listId,
      contactId: contact.id,
      sentAt: i === 0 ? new Date("2026-11-07T09:00:00Z") : null,
    });
  }
  const [lap] = await t.db
    .insert(laps)
    .values({
      organisationId: org,
      campaignId,
      listId,
      routeId,
      testSize: 10,
      status: "done",
      sent: 10,
      clicks: 2,
      costMicro: 250_000n,
      startedAt: new Date("2026-11-07T09:00:00Z"),
      finishedAt: new Date("2026-11-07T09:05:00Z"),
    })
    .returning({ id: laps.id });
  if (!lap) throw new Error("seed failed");
  testLapId = lap.id;
});

afterAll(async () => {
  await t.close();
});

describe("createAutosenderStore", () => {
  it("lists the campaigns AutoSender runs, with their knobs", async () => {
    const store = createAutosenderStore(t.db);
    const rows = await store.listAutosenderCampaigns();
    expect(rows).toEqual([
      {
        id: campaignId,
        organisationId: org,
        testSize: 10,
        contactReuse: "account_wide",
        measureMinutes: 30,
        scaleFactor: 5,
        ctrFloorPercent: 80,
      },
    ]);
  });

  it("reads the laps with their stage and what is left on each list", async () => {
    const store = createAutosenderStore(t.db);
    const campaign = (await store.listAutosenderCampaigns())[0];
    if (!campaign) throw new Error("campaign missing");
    const lapRows = await store.listLaps(campaignId);
    expect(lapRows).toHaveLength(1);
    expect(lapRows[0]).toMatchObject({
      id: testLapId,
      routeId,
      listId,
      status: "done",
      scale: false,
      sent: 10,
      clicks: 2,
      costMicro: 250_000,
    });
    expect(await store.availableByList(campaign)).toEqual([{ listId, available: 2 }]);
  });

  it("queues scale-out laps flagged autosender with one audit row", async () => {
    const store = createAutosenderStore(t.db);
    const campaign = (await store.listAutosenderCampaigns())[0];
    if (!campaign) throw new Error("campaign missing");
    const ids = await store.createScaleLaps({
      campaign,
      routeId,
      laps: [{ listId, count: 2 }],
      testCtr: 0.2,
    });
    expect(ids).toHaveLength(1);
    const [lap] = await t.db
      .select()
      .from(laps)
      .where(eq(laps.id, ids[0] ?? ""));
    expect(lap).toMatchObject({ status: "queued", testSize: 2, autosender: true, routeId, listId });
    const audit = await t.db.select().from(auditLog).where(eq(auditLog.action, "autosender.scale"));
    expect(audit).toHaveLength(1);
    expect(audit[0]?.details).toMatchObject({ routeId, testCtr: 0.2 });
    const after = await store.listLaps(campaignId);
    expect(after.map((l) => l.scale)).toEqual([false, true]);
  });

  it("stop stamps the reason and takes the campaign out of the list", async () => {
    const store = createAutosenderStore(t.db);
    await store.stop({ campaignId, organisationId: org, reason: "lists finished" });
    expect(await store.listAutosenderCampaigns()).toEqual([]);
    const [row] = await t.db
      .select({
        reason: campaigns.autosenderStopReason,
        at: campaigns.autosenderStoppedAt,
      })
      .from(campaigns)
      .where(eq(campaigns.id, campaignId));
    expect(row?.reason).toBe("lists finished");
    expect(row?.at).toBeInstanceOf(Date);
    const audit = await t.db.select().from(auditLog).where(eq(auditLog.action, "autosender.stop"));
    expect(audit).toHaveLength(1);
  });
});
