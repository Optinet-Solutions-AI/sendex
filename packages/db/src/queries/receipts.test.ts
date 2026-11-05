import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { campaigns, contacts, laps, lists, messages, routes } from "../schema/index.js";
import { createTestDb, seedOrganisation, type TestDb } from "../test/db.js";
import {
  applyDeliveryReceipt,
  expireStaleMessages,
  NO_RECEIPT_ERROR_CODE,
  RECEIPT_WINDOW_MS,
} from "./receipts.js";

let t: TestDb;
let org: string;
let otherOrg: string;
let lapId: string;
let smppLapId: string;
const ids: Record<string, string> = {};

const NOW = new Date("2026-11-06T12:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 60 * 60 * 1000);

async function lapCounters(id = lapId) {
  const [lap] = await t.db
    .select({ sent: laps.sent, delivered: laps.delivered, failed: laps.failed })
    .from(laps)
    .where(eq(laps.id, id));
  return lap;
}

async function message(key: string) {
  const [row] = await t.db
    .select()
    .from(messages)
    .where(eq(messages.id, ids[key] ?? ""));
  return row;
}

beforeAll(async () => {
  t = await createTestDb();
  org = await seedOrganisation(t.db, "org-a");
  otherOrg = await seedOrganisation(t.db, "org-b");
  const [campaign] = await t.db
    .insert(campaigns)
    .values({ organisationId: org, name: "c", country: "ES", timezone: "Europe/Madrid" })
    .returning({ id: campaigns.id });
  const [list] = await t.db
    .insert(lists)
    .values({ organisationId: org, name: "l", country: "ES" })
    .returning({ id: lists.id });
  const [fakeRoute] = await t.db
    .insert(routes)
    .values({ provider: "fake", name: "fake-1", country: "ES" })
    .returning({ id: routes.id });
  const [smppRoute] = await t.db
    .insert(routes)
    .values({ provider: "smpp", name: "23t", country: "ES" })
    .returning({ id: routes.id });
  const [contact] = await t.db
    .insert(contacts)
    .values({ organisationId: org, e164: "+34600000001", country: "ES" })
    .returning({ id: contacts.id });
  if (!campaign || !list || !fakeRoute || !smppRoute || !contact) throw new Error("setup failed");
  const lapRows = await t.db
    .insert(laps)
    .values([
      {
        organisationId: org,
        campaignId: campaign.id,
        listId: list.id,
        routeId: fakeRoute.id,
        testSize: 10,
        status: "done",
        sent: 4,
      },
      {
        organisationId: org,
        campaignId: campaign.id,
        listId: list.id,
        routeId: smppRoute.id,
        testSize: 10,
        status: "done",
        sent: 1,
      },
    ])
    .returning({ id: laps.id });
  const [fakeLap, smppLap] = lapRows;
  if (!fakeLap || !smppLap) throw new Error("setup failed");
  lapId = fakeLap.id;
  smppLapId = smppLap.id;

  const specs: Array<{
    key: string;
    lapId: string;
    routeId: string;
    providerMessageId: string | null;
    status: "queued" | "sent";
    sentAt: Date | null;
  }> = [
    {
      key: "a",
      lapId,
      routeId: fakeRoute.id,
      providerMessageId: "p-1",
      status: "sent",
      sentAt: hoursAgo(1),
    },
    {
      key: "b",
      lapId,
      routeId: fakeRoute.id,
      providerMessageId: "p-2",
      status: "sent",
      sentAt: hoursAgo(1),
    },
    {
      key: "old",
      lapId,
      routeId: fakeRoute.id,
      providerMessageId: "p-3",
      status: "sent",
      sentAt: hoursAgo(25),
    },
    {
      key: "fresh",
      lapId,
      routeId: fakeRoute.id,
      providerMessageId: "p-4",
      status: "sent",
      sentAt: hoursAgo(23),
    },
    {
      key: "queued",
      lapId,
      routeId: fakeRoute.id,
      providerMessageId: null,
      status: "queued",
      sentAt: null,
    },
    // Same carrier id as "a", on a route of another provider.
    {
      key: "smpp",
      lapId: smppLapId,
      routeId: smppRoute.id,
      providerMessageId: "p-1",
      status: "sent",
      sentAt: hoursAgo(1),
    },
  ];
  for (const spec of specs) {
    const [row] = await t.db
      .insert(messages)
      .values({
        organisationId: org,
        campaignId: campaign.id,
        lapId: spec.lapId,
        contactId: contact.id,
        routeId: spec.routeId,
        e164: "+34600000001",
        senderId: "LUCKY777",
        text: "hi",
        encoding: "GSM_7BIT",
        status: spec.status,
        providerMessageId: spec.providerMessageId,
        sentAt: spec.sentAt,
        idempotencyKey: `k-${spec.key}`,
      })
      .returning({ id: messages.id });
    if (!row) throw new Error("setup failed");
    ids[spec.key] = row.id;
  }
});

afterAll(async () => {
  await t.close();
});

describe("applyDeliveryReceipt", () => {
  const at = new Date("2026-11-06T11:30:00.000Z");

  it("marks a sent message delivered with its timestamp and counts it on the lap", async () => {
    const result = await applyDeliveryReceipt(t.db, {
      provider: "fake",
      receipt: { providerMessageId: "p-1", status: "delivered", at },
    });
    expect(result).toMatchObject({
      outcome: "applied",
      status: "delivered",
      messageId: ids.a,
      lapId,
    });
    expect(await message("a")).toMatchObject({
      status: "delivered",
      deliveredAt: at,
      errorCode: null,
    });
    expect(await lapCounters()).toEqual({ sent: 4, delivered: 1, failed: 0 });
  });

  it("ignores a second receipt for the same message, and a failure after a delivery", async () => {
    await expect(
      applyDeliveryReceipt(t.db, {
        provider: "fake",
        receipt: { providerMessageId: "p-1", status: "delivered", at },
      }),
    ).resolves.toMatchObject({ outcome: "ignored", status: "delivered", messageId: ids.a });
    await expect(
      applyDeliveryReceipt(t.db, {
        provider: "fake",
        receipt: { providerMessageId: "p-1", status: "failed", errorCode: "001", at },
      }),
    ).resolves.toMatchObject({ outcome: "ignored", status: "delivered" });
    expect(await message("a")).toMatchObject({ status: "delivered", errorCode: null });
    expect(await lapCounters()).toEqual({ sent: 4, delivered: 1, failed: 0 });
  });

  it("marks a sent message failed with the carrier error code and counts it as failed", async () => {
    const result = await applyDeliveryReceipt(t.db, {
      provider: "fake",
      receipt: { providerMessageId: "p-2", status: "failed", errorCode: "001", at },
    });
    expect(result).toMatchObject({ outcome: "applied", status: "failed", messageId: ids.b });
    expect(await message("b")).toMatchObject({
      status: "failed",
      errorCode: "001",
      deliveredAt: null,
    });
    expect(await lapCounters()).toEqual({ sent: 4, delivered: 1, failed: 1 });
  });

  it("reports an unknown carrier id, and scopes by provider and organisation", async () => {
    await expect(
      applyDeliveryReceipt(t.db, {
        provider: "fake",
        receipt: { providerMessageId: "nope", status: "delivered", at },
      }),
    ).resolves.toEqual({ outcome: "unknown" });
    // "p-1" exists on the fake route (already delivered) and on the smpp route (still sent).
    const smpp = await applyDeliveryReceipt(t.db, {
      provider: "smpp",
      receipt: { providerMessageId: "p-1", status: "delivered", at },
    });
    expect(smpp).toMatchObject({ outcome: "applied", messageId: ids.smpp, lapId: smppLapId });
    expect(await lapCounters(smppLapId)).toEqual({ sent: 1, delivered: 1, failed: 0 });
    await expect(
      applyDeliveryReceipt(t.db, {
        provider: "fake",
        organisationId: otherOrg,
        receipt: { providerMessageId: "p-4", status: "delivered", at },
      }),
    ).resolves.toEqual({ outcome: "unknown" });
    expect(await message("fresh")).toMatchObject({ status: "sent" });
  });
});

describe("expireStaleMessages", () => {
  it("expires sent messages older than the window and counts them as failed", async () => {
    const olderThan = new Date(NOW.getTime() - RECEIPT_WINDOW_MS);
    expect(await expireStaleMessages(t.db, olderThan)).toBe(1);
    expect(await message("old")).toMatchObject({
      status: "expired",
      errorCode: NO_RECEIPT_ERROR_CODE,
    });
    expect(await message("fresh")).toMatchObject({ status: "sent" });
    expect(await message("queued")).toMatchObject({ status: "queued" });
    expect(await message("a")).toMatchObject({ status: "delivered" });
    expect(await lapCounters()).toEqual({ sent: 4, delivered: 1, failed: 2 });
  });

  it("is a no-op the second time, and a late receipt for an expired message is ignored", async () => {
    const olderThan = new Date(NOW.getTime() - RECEIPT_WINDOW_MS);
    expect(await expireStaleMessages(t.db, olderThan)).toBe(0);
    await expect(
      applyDeliveryReceipt(t.db, {
        provider: "fake",
        receipt: { providerMessageId: "p-3", status: "delivered", at: NOW },
      }),
    ).resolves.toMatchObject({ outcome: "ignored", status: "expired" });
    expect(await lapCounters()).toEqual({ sent: 4, delivered: 1, failed: 2 });
  });

  it("respects the per-call limit", async () => {
    // "fresh" becomes stale once the window moves past it.
    const olderThan = new Date(NOW.getTime() - 22 * 60 * 60 * 1000);
    expect(await expireStaleMessages(t.db, olderThan, { limit: 0 })).toBe(0);
    expect(await expireStaleMessages(t.db, olderThan, { limit: 1 })).toBe(1);
    expect(await lapCounters()).toEqual({ sent: 4, delivered: 1, failed: 3 });
  });
});
