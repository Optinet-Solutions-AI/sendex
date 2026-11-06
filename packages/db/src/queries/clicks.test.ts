import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  campaignLinks,
  campaigns,
  clicks,
  contacts,
  laps,
  links,
  lists,
  messages,
  routes,
} from "../schema/index.js";
import { createTestDb, seedOrganisation, type TestDb } from "../test/db.js";
import { findMessagesByShortCodes, findShortCodeTarget, recordClicks } from "./clicks.js";

let t: TestDb;
let org: string;
let campaignId: string;
let lapId: string;
let listId: string;
let messageId: string;

const CODE = "abcdefgh";
const TEMPLATE = "https://dest.example/?d={{dynamic}}&g={{geo}}";

beforeAll(async () => {
  t = await createTestDb();
  org = await seedOrganisation(t.db, "org-a");
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
    .values({ provider: "fake", name: "23telecom", country: "ES" })
    .returning({ id: routes.id });
  const [contact] = await t.db
    .insert(contacts)
    .values({ organisationId: org, e164: "+34600000001", country: "ES" })
    .returning({ id: contacts.id });
  if (!campaign || !list || !route || !contact) throw new Error("setup failed");
  const [lap] = await t.db
    .insert(laps)
    .values({
      organisationId: org,
      campaignId: campaign.id,
      listId: list.id,
      routeId: route.id,
      testSize: 200,
    })
    .returning({ id: laps.id });
  const [link] = await t.db
    .insert(links)
    .values({ organisationId: org, name: "offer", url: TEMPLATE })
    .returning({ id: links.id });
  if (!lap || !link) throw new Error("setup failed");
  await t.db
    .insert(campaignLinks)
    .values({ campaignId: campaign.id, linkId: link.id, organisationId: org });
  const [message] = await t.db
    .insert(messages)
    .values({
      organisationId: org,
      campaignId: campaign.id,
      lapId: lap.id,
      contactId: contact.id,
      routeId: route.id,
      e164: "+34600000001",
      senderId: "LUCKY777",
      text: "Hello https://lnk.example/abcdefgh",
      encoding: "GSM_7BIT",
      parts: 1,
      shortCode: CODE,
      dynamicId: "dyn-1",
      idempotencyKey: "lap:1:contact:1",
    })
    .returning({ id: messages.id });
  if (!message) throw new Error("setup failed");
  campaignId = campaign.id;
  lapId = lap.id;
  listId = list.id;
  messageId = message.id;
});

afterAll(async () => {
  await t.close();
});

describe("findShortCodeTarget", () => {
  it("returns the message, its context and the campaign's link template", async () => {
    await expect(findShortCodeTarget(t.db, CODE)).resolves.toEqual({
      messageId,
      organisationId: org,
      campaignId,
      lapId,
      listId,
      routeName: "23telecom",
      campaignCountry: "ES",
      dynamicId: "dyn-1",
      e164: "+34600000001",
      urlTemplate: TEMPLATE,
    });
  });

  it("returns null for an unknown code", async () => {
    await expect(findShortCodeTarget(t.db, "zzzzzzzz")).resolves.toBeNull();
  });
});

describe("findMessagesByShortCodes", () => {
  it("returns the known codes only and nothing for an empty list", async () => {
    await expect(findMessagesByShortCodes(t.db, [CODE, "zzzzzzzz"])).resolves.toEqual([
      { id: messageId, shortCode: CODE, organisationId: org, campaignId, lapId },
    ]);
    await expect(findMessagesByShortCodes(t.db, [])).resolves.toEqual([]);
  });
});

describe("recordClicks", () => {
  it("inserts the rows and counts the message once on the lap, in one go", async () => {
    const at = new Date("2026-11-06T10:00:00.000Z");
    const inserted = await recordClicks(t.db, [
      {
        organisationId: org,
        messageId,
        campaignId,
        lapId,
        at,
        ip: "203.0.113.9",
        country: "ES",
        userAgent: "ua-1",
        device: "mobile",
        operator: "Vodafone Spain",
      },
      {
        organisationId: org,
        messageId,
        campaignId,
        lapId,
        at,
        ip: null,
        country: null,
        userAgent: null,
        device: null,
        operator: null,
      },
    ]);
    expect(inserted).toBe(2);

    const rows = await t.db.select().from(clicks).where(eq(clicks.messageId, messageId));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      at,
      ip: "203.0.113.9",
      country: "ES",
      userAgent: "ua-1",
      device: "mobile",
      operator: "Vodafone Spain",
    });
    // Two clicks on one message: two rows, one clicker.
    const [lap] = await t.db.select({ clicks: laps.clicks }).from(laps).where(eq(laps.id, lapId));
    expect(lap?.clicks).toBe(1);
  });

  it("counts a second message, and a replayed batch does not inflate the counter", async () => {
    const [contact] = await t.db
      .insert(contacts)
      .values({ organisationId: org, e164: "+34600000002", country: "ES" })
      .returning({ id: contacts.id });
    const [route] = await t.db.select({ id: routes.id }).from(routes).limit(1);
    if (!contact || !route) throw new Error("setup failed");
    const [second] = await t.db
      .insert(messages)
      .values({
        organisationId: org,
        campaignId,
        lapId,
        contactId: contact.id,
        routeId: route.id,
        e164: "+34600000002",
        senderId: "LUCKY777",
        text: "Hello https://lnk.example/bcdefghj",
        encoding: "GSM_7BIT",
        parts: 1,
        shortCode: "bcdefghj",
        dynamicId: "dyn-2",
        idempotencyKey: "lap:1:contact:2",
      })
      .returning({ id: messages.id });
    if (!second) throw new Error("setup failed");
    const batch = [
      {
        organisationId: org,
        messageId: second.id,
        campaignId,
        lapId,
        at: new Date("2026-11-06T10:05:00.000Z"),
        ip: null,
        country: null,
        userAgent: null,
        device: null,
        operator: null,
      },
    ];
    await recordClicks(t.db, batch);
    await recordClicks(t.db, batch);
    const rows = await t.db.select().from(clicks).where(eq(clicks.lapId, lapId));
    expect(rows).toHaveLength(4);
    const [lap] = await t.db.select({ clicks: laps.clicks }).from(laps).where(eq(laps.id, lapId));
    expect(lap?.clicks).toBe(2);
  });

  it("does nothing for an empty batch", async () => {
    await expect(recordClicks(t.db, [])).resolves.toBe(0);
    const [lap] = await t.db.select({ clicks: laps.clicks }).from(laps).where(eq(laps.id, lapId));
    expect(lap?.clicks).toBe(2);
  });
});
