import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  campaigns,
  clicks,
  contacts,
  laps,
  lists,
  messages,
  routes,
  senderIds,
  sidGroups,
} from "../schema/index.js";
import { createTestDb, seedOrganisation, type TestDb } from "../test/db.js";
import { listCampaignMessages, maskRecipient } from "./campaign-messages.js";
import { sidGroupStats } from "./campaigns.js";

let t: TestDb;
let org: string;
let other: string;
let campaignId: string;
let groupId: string;
let emptyGroupId: string;

beforeAll(async () => {
  t = await createTestDb();
  org = await seedOrganisation(t.db, "org-a");
  other = await seedOrganisation(t.db, "org-b");
  const [campaign] = await t.db
    .insert(campaigns)
    .values({ organisationId: org, name: "c", country: "ES", timezone: "Europe/Madrid" })
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
  if (!campaign || !list || !route || !contact) throw new Error("seed failed");
  campaignId = campaign.id;
  const [lap] = await t.db
    .insert(laps)
    .values({
      organisationId: org,
      campaignId,
      listId: list.id,
      routeId: route.id,
      testSize: 10,
      status: "done",
      sent: 3,
    })
    .returning({ id: laps.id });
  if (!lap) throw new Error("seed failed");
  const groups = await t.db
    .insert(sidGroups)
    .values([
      { organisationId: org, name: "SID ES", country: "ES" },
      { organisationId: org, name: "SID empty", country: "ES" },
      { organisationId: other, name: "SID other", country: "ES" },
    ])
    .returning({ id: sidGroups.id });
  const [g1, g2, g3] = groups;
  if (!g1 || !g2 || !g3) throw new Error("seed failed");
  groupId = g1.id;
  emptyGroupId = g2.id;
  await t.db.insert(senderIds).values([
    { organisationId: org, sidGroupId: g1.id, value: "LUCKY777" },
    { organisationId: org, sidGroupId: g1.id, value: "BIGSPINS" },
    { organisationId: other, sidGroupId: g3.id, value: "LUCKY777" },
  ]);
  const specs = [
    { key: "a", senderId: "LUCKY777", status: "delivered" as const },
    { key: "b", senderId: "BIGSPINS", status: "sent" as const },
    { key: "c", senderId: "LUCKY777", status: "failed" as const },
    { key: "d", senderId: "OTHER", status: "sent" as const },
  ];
  const inserted = [];
  for (const spec of specs) {
    const [row] = await t.db
      .insert(messages)
      .values({
        organisationId: org,
        campaignId,
        lapId: lap.id,
        contactId: contact.id,
        routeId: route.id,
        e164: "+34600000001",
        senderId: spec.senderId,
        text: `hi ${spec.key}`,
        encoding: "GSM_7BIT",
        status: spec.status,
        idempotencyKey: `k-${spec.key}`,
      })
      .returning({ id: messages.id });
    if (!row) throw new Error("seed failed");
    inserted.push(row.id);
  }
  const [first] = inserted;
  if (!first) throw new Error("seed failed");
  await t.db.insert(clicks).values([
    { organisationId: org, messageId: first, campaignId, lapId: lap.id },
    { organisationId: org, messageId: first, campaignId, lapId: lap.id },
  ]);
});

afterAll(async () => {
  await t.close();
});

describe("listCampaignMessages", () => {
  it("pages the campaign's messages newest first with masked recipients and a clicked flag", async () => {
    const page = await listCampaignMessages(t.db, org, campaignId, { pageSize: 3 });
    expect(page.total).toBe(4);
    expect(page.rows).toHaveLength(3);
    expect(page.rows.every((r) => r.recipient === "+3460000****")).toBe(true);
    expect(page.rows.map((r) => r.routeName)).toEqual(["405", "405", "405"]);
    expect(page.rows.every((r) => r.clicked === false)).toBe(true);
    // The oldest message, "hi a", is the clicked one and lands on the second page.
    const second = await listCampaignMessages(t.db, org, campaignId, { page: 2, pageSize: 3 });
    expect(second.rows).toHaveLength(1);
    expect(second.rows[0]).toMatchObject({ text: "hi a", clicked: true, status: "delivered" });
  });

  it("is scoped by organisation", async () => {
    await expect(listCampaignMessages(t.db, other, campaignId)).resolves.toMatchObject({
      total: 0,
      rows: [],
    });
  });
});

describe("maskRecipient", () => {
  it("hides the last four digits", () => {
    expect(maskRecipient("+447700900123")).toBe("+44770090****");
    expect(maskRecipient("123")).toBe("****");
  });
});

describe("sidGroupStats", () => {
  it("counts accepted messages and clicked messages per group, by sender id value, within the organisation", async () => {
    const stats = await sidGroupStats(t.db, org, [groupId, emptyGroupId]);
    expect(stats.find((s) => s.groupId === groupId)).toEqual({ groupId, sent: 2, clicks: 1 });
    expect(stats.find((s) => s.groupId === emptyGroupId)).toEqual({
      groupId: emptyGroupId,
      sent: 0,
      clicks: 0,
    });
    await expect(sidGroupStats(t.db, org, [])).resolves.toEqual([]);
  });
});
