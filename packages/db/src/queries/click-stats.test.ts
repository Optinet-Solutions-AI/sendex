import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  adTexts,
  campaigns,
  contacts,
  laps,
  links,
  lists,
  messages,
  routes,
} from "../schema/index.js";
import { createTestDb, seedOrganisation, type TestDb } from "../test/db.js";
import { clickStats } from "./click-stats.js";
import { recordClicks } from "./clicks.js";

let t: TestDb;
let org: string;
let otherOrg: string;
let campaignId: string;
let lap1: string;
let lap2: string;
let text1: string;
let text2: string;
let link1: string;

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
  const routeRows = await t.db
    .insert(routes)
    .values([
      { provider: "fake", name: "405", country: "ES" },
      { provider: "fake", name: "403", country: "ES" },
    ])
    .returning({ id: routes.id });
  const [contact] = await t.db
    .insert(contacts)
    .values({ organisationId: org, e164: "+34600000001", country: "ES" })
    .returning({ id: contacts.id });
  const [r1, r2] = routeRows;
  if (!campaign || !list || !r1 || !r2 || !contact) throw new Error("setup failed");
  campaignId = campaign.id;
  const lapRows = await t.db
    .insert(laps)
    .values([
      {
        organisationId: org,
        campaignId,
        listId: list.id,
        routeId: r1.id,
        testSize: 10,
        status: "done",
        sent: 4,
        delivered: 3,
        failed: 1,
        costMicro: 100_000n,
        createdAt: new Date("2026-11-05T10:00:00Z"),
      },
      {
        organisationId: org,
        campaignId,
        listId: list.id,
        routeId: r2.id,
        testSize: 10,
        status: "done",
        sent: 2,
        delivered: 2,
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
  const [link] = await t.db
    .insert(links)
    .values({ organisationId: org, name: "offer", url: "https://dest.example/?d={{dynamic}}" })
    .returning({ id: links.id });
  const [l1, l2] = lapRows;
  const [t1, t2] = textRows;
  if (!l1 || !l2 || !t1 || !t2 || !link) throw new Error("setup failed");
  lap1 = l1.id;
  lap2 = l2.id;
  text1 = t1.id;
  text2 = t2.id;
  link1 = link.id;

  const specs = [
    {
      key: "a",
      lapId: lap1,
      senderId: "SID1",
      adTextId: text1,
      linkId: link1,
      status: "delivered",
    },
    {
      key: "b",
      lapId: lap1,
      senderId: "SID1",
      adTextId: text2,
      linkId: link1,
      status: "delivered",
    },
    {
      key: "c",
      lapId: lap1,
      senderId: "SID2",
      adTextId: text1,
      linkId: link1,
      status: "delivered",
    },
    { key: "d", lapId: lap1, senderId: "SID2", adTextId: text2, linkId: link1, status: "failed" },
    { key: "e", lapId: lap2, senderId: "SID1", adTextId: text1, linkId: null, status: "delivered" },
    { key: "f", lapId: lap2, senderId: "SID2", adTextId: null, linkId: null, status: "delivered" },
    // Rejected at submit: never accepted, not "sent" for CTR.
    { key: "g", lapId: lap2, senderId: "SID2", adTextId: text1, linkId: null, status: "failed" },
  ] as const;
  const ids: Record<string, string> = {};
  for (const spec of specs) {
    const accepted = spec.key !== "g";
    const [row] = await t.db
      .insert(messages)
      .values({
        organisationId: org,
        campaignId,
        lapId: spec.lapId,
        contactId: contact.id,
        routeId: spec.lapId === lap1 ? r1.id : r2.id,
        e164: "+34600000001",
        senderId: spec.senderId,
        text: "hi",
        encoding: "GSM_7BIT",
        status: spec.status,
        sentAt: accepted ? new Date("2026-11-05T10:05:00Z") : null,
        adTextId: spec.adTextId,
        linkId: spec.linkId,
        idempotencyKey: `k-${spec.key}`,
      })
      .returning({ id: messages.id });
    if (!row) throw new Error("setup failed");
    ids[spec.key] = row.id;
  }
  const click = (key: string, lapId: string, minute: number) => ({
    organisationId: org,
    messageId: ids[key] ?? "",
    campaignId,
    lapId,
    at: new Date(`2026-11-05T12:${String(minute).padStart(2, "0")}:00Z`),
    ip: null,
    country: null,
    userAgent: null,
    device: null,
    operator: null,
  });
  // a clicked three times, c once (lap 1); e once (lap 2).
  await recordClicks(t.db, [
    click("a", lap1, 0),
    click("a", lap1, 1),
    click("c", lap1, 2),
    click("e", lap2, 3),
  ]);
  await recordClicks(t.db, [click("a", lap1, 4)]);
});

afterAll(async () => {
  await t.close();
});

describe("clickStats", () => {
  it("is null for a campaign of another organisation", async () => {
    await expect(clickStats(t.db, otherOrg, campaignId)).resolves.toBeNull();
  });

  it("totals the laps and reads the lap counters, unique clickers only", async () => {
    const stats = await clickStats(t.db, org, campaignId);
    if (!stats) throw new Error("expected stats");
    expect(stats.campaign).toEqual({
      key: campaignId,
      label: "Spring ES",
      sent: 6,
      delivered: 5,
      clicks: 3,
      rawClicks: 5,
      costMicro: 160_000,
      ctr: 0.5,
      cpcMicro: 53_333,
      deliveryRate: 5 / 6,
    });
    expect(stats.laps.map((l) => [l.label, l.sent, l.clicks, l.rawClicks, l.cpcMicro])).toEqual([
      ["405", 4, 2, 4, 50_000],
      ["403", 2, 1, 1, 60_000],
    ]);
    expect(stats.laps[0]).toMatchObject({ key: lap1, ctr: 0.5, deliveryRate: 0.75 });
  });

  it("breaks clicks down per sender id with the lap cost allocated per message", async () => {
    const stats = await clickStats(t.db, org, campaignId);
    if (!stats) throw new Error("expected stats");
    // SID1: a, b (lap 1, 25 000 each) + e (lap 2, 30 000); clicks on a and e.
    // SID2: c, d (lap 1) + f (lap 2) + g (rejected, no cost); one click on c.
    expect(stats.senderIds).toEqual([
      expect.objectContaining({
        key: "SID1",
        sent: 3,
        delivered: 3,
        clicks: 2,
        rawClicks: 4,
        costMicro: 80_000,
        ctr: 2 / 3,
        cpcMicro: 40_000,
      }),
      expect.objectContaining({
        key: "SID2",
        sent: 3,
        delivered: 2,
        clicks: 1,
        rawClicks: 1,
        costMicro: 80_000,
        ctr: 1 / 3,
        cpcMicro: 80_000,
      }),
    ]);
  });

  it("breaks clicks down per ad text and per link, with a row for messages without one", async () => {
    const stats = await clickStats(t.db, org, campaignId);
    if (!stats) throw new Error("expected stats");
    expect(stats.adTexts.map((r) => [r.key, r.label, r.sent, r.clicks, r.costMicro])).toEqual([
      [text1, "text one", 3, 3, 80_000],
      [text2, "text two", 2, 0, 50_000],
      ["", "No ad text", 1, 0, 30_000],
    ]);
    expect(stats.adTexts[1]).toMatchObject({ ctr: 0, cpcMicro: null });
    expect(stats.links.map((r) => [r.key, r.label, r.sent, r.clicks])).toEqual([
      [link1, "offer", 4, 2],
      ["", "No link", 2, 1],
    ]);
  });
});
