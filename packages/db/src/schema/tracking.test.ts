import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, expectUniqueViolation, seedOrganisation, type TestDb } from "../test/db.js";
import { campaigns, laps } from "./campaigns.js";
import { contacts, lists } from "./lists.js";
import { routes } from "./routes.js";
import { clicks, messages, postbacks } from "./tracking.js";

let t: TestDb;
let org: string;
let campaignId: string;
let lapId: string;
let contactId: string;
let routeId: string;

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
    .values({ provider: "fake", name: "fake", country: "ES" })
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
  if (!lap) throw new Error("setup failed");
  campaignId = campaign.id;
  lapId = lap.id;
  contactId = contact.id;
  routeId = route.id;
});

afterAll(async () => {
  await t.close();
});

function message(idempotencyKey: string) {
  return {
    organisationId: org,
    campaignId,
    lapId,
    contactId,
    routeId,
    e164: "+34600000001",
    senderId: "LUCKY777",
    text: "Hello",
    encoding: "GSM_7BIT",
    parts: 1,
    idempotencyKey,
  };
}

describe("messages", () => {
  it("starts queued and rejects a duplicate idempotency key", async () => {
    const [row] = await t.db.insert(messages).values(message("lap:1:contact:1")).returning();
    expect(row?.status).toBe("queued");
    expect(row?.sentAt).toBeNull();
    await expectUniqueViolation(t.db.insert(messages).values(message("lap:1:contact:1")));
  });

  it("records a click against a message", async () => {
    const [row] = await t.db
      .insert(messages)
      .values({ ...message("lap:1:contact:2"), shortCode: "abc123", dynamicId: "dyn-2" })
      .returning({ id: messages.id });
    if (!row) throw new Error("setup failed");
    const [click] = await t.db
      .insert(clicks)
      .values({ organisationId: org, messageId: row.id, campaignId, lapId, ip: "203.0.113.9" })
      .returning();
    expect(click?.at).toBeInstanceOf(Date);
    expect(click?.country).toBeNull();
  });
});

describe("postbacks", () => {
  it("rejects a duplicate event_key", async () => {
    await t.db.insert(postbacks).values({
      organisationId: org,
      eventKey: "evt-1",
      type: "lead",
      dynamicId: "dyn-2",
      params: { sub_id1: "dyn-2" },
    });
    await expectUniqueViolation(
      t.db.insert(postbacks).values({
        organisationId: org,
        eventKey: "evt-1",
        type: "sale",
        dynamicId: "dyn-2",
        valueMicro: 50_000_000n,
      }),
    );
  });

  it("can arrive before it is matched to a message", async () => {
    const [row] = await t.db
      .insert(postbacks)
      .values({ organisationId: org, eventKey: "evt-2", type: "sale", dynamicId: "unknown" })
      .returning();
    expect(row?.messageId).toBeNull();
    expect(row?.campaignId).toBeNull();
    expect(row?.lapId).toBeNull();
    expect(row?.valueMicro).toBeNull();
  });
});
