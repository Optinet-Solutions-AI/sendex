import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  auditLog,
  campaigns,
  contacts,
  laps,
  ledgerEntries,
  listMembers,
  lists,
  messages,
  routes,
} from "../schema/index.js";
import { createTestDb, seedOrganisation, type TestDb } from "../test/db.js";
import {
  cancelSchedule,
  listScheduledCampaigns,
  pauseCampaign,
  rescheduleCampaign,
  resumeCampaign,
  stopCampaign,
} from "./campaign-control.js";
import { getBalanceMicro } from "./ledger.js";
import { createSendingStore } from "./sending.js";

let t: TestDb;
let org: string;
let otherOrg: string;
let listId: string;
let routeId: string;
let userId: string | null = null;

function must<T>(row: T | undefined, what: string): T {
  if (row === undefined) throw new Error(`${what} returned no row`);
  return row;
}

type Status = "draft" | "scheduled" | "sending" | "paused" | "stopped" | "completed";

async function addCampaign(
  name: string,
  status: Status,
  scheduledAt: Date | null = null,
  organisationId = org,
  timezone = "Europe/Madrid",
): Promise<string> {
  return must(
    (
      await t.db
        .insert(campaigns)
        .values({ organisationId, name, country: "ES", timezone, status, scheduledAt })
        .returning({ id: campaigns.id })
    )[0],
    "campaign",
  ).id;
}

async function addLap(
  campaignId: string,
  status: "queued" | "sending" | "done" | "cancelled",
  testSize = 10,
): Promise<string> {
  return must(
    (
      await t.db
        .insert(laps)
        .values({ organisationId: org, campaignId, listId, routeId, testSize, status })
        .returning({ id: laps.id })
    )[0],
    "lap",
  ).id;
}

let contactSeq = 0;
async function addMessage(
  campaignId: string,
  lapId: string,
  status: "queued" | "sent" | "failed",
): Promise<string> {
  contactSeq += 1;
  const contact = must(
    (
      await t.db
        .insert(contacts)
        .values({
          organisationId: org,
          e164: `+3460000${String(contactSeq).padStart(4, "0")}`,
          country: "ES",
        })
        .returning({ id: contacts.id })
    )[0],
    "contact",
  );
  const row = must(
    (
      await t.db
        .insert(messages)
        .values({
          organisationId: org,
          campaignId,
          lapId,
          contactId: contact.id,
          routeId,
          e164: "+34600000000",
          senderId: "LUCKY777",
          text: "x",
          encoding: "GSM_7BIT",
          parts: 1,
          status,
          idempotencyKey: `${lapId}:${contact.id}`,
        })
        .returning({ id: messages.id })
    )[0],
    "message",
  );
  await t.db.insert(ledgerEntries).values({
    organisationId: org,
    kind: "debit",
    amountMicro: -25_000n,
    referenceType: "message",
    referenceId: row.id,
    idempotencyKey: `msg:${row.id}`,
  });
  return row.id;
}

async function campaignRow(id: string) {
  return must((await t.db.select().from(campaigns).where(eq(campaigns.id, id)))[0], "campaign");
}

async function audits(targetId: string) {
  return t.db
    .select({ action: auditLog.action, details: auditLog.details, actor: auditLog.actorUserId })
    .from(auditLog)
    .where(eq(auditLog.targetId, targetId))
    .orderBy(auditLog.createdAt);
}

beforeAll(async () => {
  t = await createTestDb();
  org = await seedOrganisation(t.db, "org-a");
  otherOrg = await seedOrganisation(t.db, "org-b");
  listId = must(
    (
      await t.db
        .insert(lists)
        .values({ organisationId: org, name: "ES list", country: "ES" })
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
  await t.db.insert(ledgerEntries).values({
    organisationId: org,
    kind: "deposit",
    amountMicro: 1_000_000n,
    idempotencyKey: "deposit:1",
  });
  userId = null;
  // list_members are not needed for these helpers; keep one so the list is not empty.
  const [c] = await t.db
    .insert(contacts)
    .values({ organisationId: org, e164: "+34611111111", country: "ES" })
    .returning({ id: contacts.id });
  if (c) await t.db.insert(listMembers).values({ organisationId: org, listId, contactId: c.id });
});

afterAll(() => t.close());

describe("pauseCampaign / resumeCampaign", () => {
  it("pauses a sending campaign and resumes it to sending, with audit rows", async () => {
    const id = await addCampaign("pause me", "sending");
    const paused = await pauseCampaign(t.db, org, id, { actorUserId: userId });
    expect(paused.status).toBe("paused");
    expect((await campaignRow(id)).status).toBe("paused");

    const resumed = await resumeCampaign(t.db, org, id, { actorUserId: userId });
    expect(resumed.status).toBe("sending");
    expect((await campaignRow(id)).status).toBe("sending");

    expect(await audits(id)).toEqual([
      { action: "campaign.pause", details: { from: "sending" }, actor: null },
      { action: "campaign.resume", details: { to: "sending" }, actor: null },
    ]);
  });

  it("a paused campaign whose start time is still ahead resumes to scheduled", async () => {
    const id = await addCampaign("later", "scheduled", new Date("2099-01-01T10:00:00Z"));
    await pauseCampaign(t.db, org, id, { actorUserId: userId });
    const resumed = await resumeCampaign(t.db, org, id, { actorUserId: userId });
    expect(resumed.status).toBe("scheduled");
  });

  it("refuses moves the state machine forbids and campaigns of another organisation", async () => {
    const draft = await addCampaign("draft", "draft");
    await expect(pauseCampaign(t.db, org, draft, { actorUserId: userId })).rejects.toThrow(
      /Cannot pause a campaign that is "draft"/,
    );
    await expect(resumeCampaign(t.db, org, draft, { actorUserId: userId })).rejects.toThrow(
      /Cannot resume/,
    );
    const foreign = await addCampaign("foreign", "sending", null, otherOrg);
    await expect(pauseCampaign(t.db, org, foreign, { actorUserId: userId })).rejects.toThrow(
      /Campaign not found/,
    );
    expect((await campaignRow(foreign)).status).toBe("sending");
  });
});

describe("stopCampaign", () => {
  it("cancels queued and sending laps; refunds the queued messages of laps that never started", async () => {
    const id = await addCampaign("stop me", "sending");
    const queuedLap = await addLap(id, "queued", 100);
    const sendingLap = await addLap(id, "sending", 100);
    const doneLap = await addLap(id, "done", 100);
    const neverA = await addMessage(id, queuedLap, "queued");
    const neverB = await addMessage(id, queuedLap, "queued");
    const sentA = await addMessage(id, sendingLap, "sent");
    const inFlight = await addMessage(id, sendingLap, "queued");
    const doneSent = await addMessage(id, doneLap, "sent");
    const before = await getBalanceMicro(t.db, org);

    const result = await stopCampaign(t.db, org, id, { actorUserId: userId });
    expect(result).toEqual({ status: "stopped", cancelledLaps: 2, cancelledMessages: 2 });
    expect((await campaignRow(id)).status).toBe("stopped");

    const lapStatus = async (lapId: string) =>
      must((await t.db.select().from(laps).where(eq(laps.id, lapId)))[0], "lap");
    expect((await lapStatus(queuedLap)).status).toBe("cancelled");
    expect((await lapStatus(queuedLap)).finishedAt).toBeInstanceOf(Date);
    expect((await lapStatus(sendingLap)).status).toBe("cancelled");
    expect((await lapStatus(doneLap)).status).toBe("done");

    const status = async (messageId: string) =>
      must((await t.db.select().from(messages).where(eq(messages.id, messageId)))[0], "message")
        .status;
    expect(await status(neverA)).toBe("cancelled");
    expect(await status(neverB)).toBe("cancelled");
    expect(await status(sentA)).toBe("sent");
    // The sending lap's job may have this one at the provider: the send loop settles it.
    expect(await status(inFlight)).toBe("queued");
    expect(await status(doneSent)).toBe("sent");

    // Two refunds of 0.025 each, derived from the debits; stopping again changes nothing.
    expect(await getBalanceMicro(t.db, org)).toBe(before + 50_000n);
    await expect(stopCampaign(t.db, org, id, { actorUserId: userId })).rejects.toThrow(
      /Cannot stop a campaign that is "stopped"/,
    );
    expect(await getBalanceMicro(t.db, org)).toBe(before + 50_000n);

    expect(await audits(id)).toEqual([
      {
        action: "campaign.stop",
        details: { from: "sending", cancelledLaps: 2, cancelledMessages: 2 },
        actor: null,
      },
    ]);
    const lapAudits = async (lapId: string) =>
      t.db
        .select({ action: auditLog.action, details: auditLog.details })
        .from(auditLog)
        .where(and(eq(auditLog.targetType, "lap"), eq(auditLog.targetId, lapId)));
    expect(await lapAudits(queuedLap)).toEqual([
      { action: "lap.cancel", details: { reason: "campaign stopped", cancelledMessages: 2 } },
    ]);
    expect(await lapAudits(sendingLap)).toEqual([
      { action: "lap.cancel", details: { reason: "campaign stopped", cancelledMessages: 0 } },
    ]);

    // When the sending lap's job wakes it sweeps what is left (the engine's cancelLap).
    await createSendingStore(t.db).cancelLap({
      lapId: sendingLap,
      organisationId: org,
      reason: "campaign stopped",
    });
    expect(await status(inFlight)).toBe("cancelled");
    expect(await getBalanceMicro(t.db, org)).toBe(before + 75_000n);
    expect(await lapAudits(sendingLap)).toHaveLength(1);
  });

  it("stops a paused or scheduled campaign too", async () => {
    const paused = await addCampaign("paused", "paused");
    await addLap(paused, "queued");
    expect(await stopCampaign(t.db, org, paused, { actorUserId: userId })).toEqual({
      status: "stopped",
      cancelledLaps: 1,
      cancelledMessages: 0,
    });
    const scheduled = await addCampaign("scheduled", "scheduled", new Date("2099-01-01"));
    expect((await stopCampaign(t.db, org, scheduled, { actorUserId: userId })).status).toBe(
      "stopped",
    );
  });

  it("the dispatcher never claims a lap of a stopped campaign", async () => {
    const id = await addCampaign("stopped early", "sending");
    const lap = await addLap(id, "queued");
    await stopCampaign(t.db, org, id, { actorUserId: userId });
    const claimed = await createSendingStore(t.db).claimQueuedLaps(new Date("2099-06-01"));
    expect(claimed.map((l) => l.id)).not.toContain(lap);
  });
});

describe("rescheduleCampaign / cancelSchedule", () => {
  it("moves the start of a scheduled campaign and keeps its laps queued", async () => {
    const id = await addCampaign("move me", "scheduled", new Date("2099-01-01T10:00:00Z"));
    const lap = await addLap(id, "queued");
    const result = await rescheduleCampaign(t.db, org, id, {
      scheduledAt: new Date("2099-01-02T08:30:00Z"),
      actorUserId: userId,
    });
    expect(result.status).toBe("scheduled");
    expect(result.scheduledAt.toISOString()).toBe("2099-01-02T08:30:00.000Z");
    const row = await campaignRow(id);
    expect(row.scheduledAt?.toISOString()).toBe("2099-01-02T08:30:00.000Z");
    expect(row.status).toBe("scheduled");
    const [lapRow] = await t.db.select().from(laps).where(eq(laps.id, lap));
    expect(lapRow?.status).toBe("queued");
    expect(await audits(id)).toEqual([
      {
        action: "campaign.reschedule",
        details: { from: "2099-01-01T10:00:00.000Z", to: "2099-01-02T08:30:00.000Z" },
        actor: null,
      },
    ]);
  });

  it("the old time no longer fires and the new one does (dispatcher honours the change)", async () => {
    const id = await addCampaign("dispatch", "scheduled", new Date("2099-03-01T10:00:00Z"));
    const lap = await addLap(id, "queued");
    await rescheduleCampaign(t.db, org, id, {
      scheduledAt: new Date("2099-03-05T10:00:00Z"),
      actorUserId: userId,
    });
    const store = createSendingStore(t.db);
    const atOldTime = await store.claimQueuedLaps(new Date("2099-03-01T10:00:01Z"));
    expect(atOldTime.map((l) => l.id)).not.toContain(lap);
    const atNewTime = await store.claimQueuedLaps(new Date("2099-03-05T10:00:01Z"));
    expect(atNewTime.map((l) => l.id)).toContain(lap);
    // Once its laps are claimed the campaign shows as sending.
    expect((await campaignRow(id)).status).toBe("sending");
  });

  it("stores a time on a draft and refuses a running campaign", async () => {
    const draft = await addCampaign("draft time", "draft");
    const result = await rescheduleCampaign(t.db, org, draft, {
      scheduledAt: new Date("2099-05-01T00:00:00Z"),
      actorUserId: userId,
    });
    expect(result.status).toBe("draft");
    expect((await campaignRow(draft)).scheduledAt?.toISOString()).toBe("2099-05-01T00:00:00.000Z");

    const sending = await addCampaign("running", "sending");
    await expect(
      rescheduleCampaign(t.db, org, sending, {
        scheduledAt: new Date("2099-05-01T00:00:00Z"),
        actorUserId: userId,
      }),
    ).rejects.toThrow(/Cannot reschedule a campaign that is "sending"/);
  });

  it("cancelling a schedule cancels the queued laps and returns the campaign to draft", async () => {
    const id = await addCampaign("cancel me", "scheduled", new Date("2099-01-01T10:00:00Z"));
    const lapA = await addLap(id, "queued");
    const lapB = await addLap(id, "queued");
    const result = await cancelSchedule(t.db, org, id, { actorUserId: userId });
    expect(result).toEqual({ status: "draft", cancelledLaps: 2 });
    const row = await campaignRow(id);
    expect(row.status).toBe("draft");
    expect(row.scheduledAt).toBeNull();
    for (const lap of [lapA, lapB]) {
      const [lapRow] = await t.db.select().from(laps).where(eq(laps.id, lap));
      expect(lapRow?.status).toBe("cancelled");
    }
    expect(await audits(id)).toEqual([
      {
        action: "campaign.schedule_cancel",
        details: { from: "scheduled", scheduledAt: "2099-01-01T10:00:00.000Z", cancelledLaps: 2 },
        actor: null,
      },
    ]);
    // The dispatcher has nothing left to claim for it.
    const claimed = await createSendingStore(t.db).claimQueuedLaps(new Date("2099-06-01"));
    expect(claimed.map((l) => l.campaignId)).not.toContain(id);
  });
});

describe("listScheduledCampaigns", () => {
  it("groups upcoming sends per day in each campaign's own timezone", async () => {
    const calendarOrg = await seedOrganisation(t.db, "calendar");
    const addScheduled = async (name: string, at: string, timezone: string, status: Status) =>
      addCampaign(name, status, new Date(at), calendarOrg, timezone);
    // 23:30 UTC on the 10th is already the 11th in Madrid (UTC+1 in January).
    const madridLate = await addScheduled(
      "Madrid late",
      "2099-01-10T23:30:00Z",
      "Europe/Madrid",
      "scheduled",
    );
    const madridMorning = await addScheduled(
      "Madrid morning",
      "2099-01-11T07:00:00Z",
      "Europe/Madrid",
      "scheduled",
    );
    const london = await addScheduled(
      "London",
      "2099-01-10T23:30:00Z",
      "Europe/London",
      "scheduled",
    );
    const pausedOne = await addScheduled(
      "Paused",
      "2099-01-12T09:00:00Z",
      "Europe/Madrid",
      "paused",
    );
    await addScheduled("Out of range", "2099-02-01T09:00:00Z", "Europe/Madrid", "scheduled");
    await addScheduled("Stopped", "2099-01-11T09:00:00Z", "Europe/Madrid", "stopped");
    await addCampaign("Other org", "scheduled", new Date("2099-01-11T09:00:00Z"), org);
    await t.db.insert(laps).values([
      { organisationId: calendarOrg, campaignId: madridMorning, listId, routeId, testSize: 200 },
      { organisationId: calendarOrg, campaignId: madridMorning, listId, routeId, testSize: 300 },
      {
        organisationId: calendarOrg,
        campaignId: madridMorning,
        listId,
        routeId,
        testSize: 999,
        status: "cancelled",
      },
    ]);

    const days = await listScheduledCampaigns(t.db, calendarOrg, {
      from: new Date("2099-01-01T00:00:00Z"),
      to: new Date("2099-01-31T00:00:00Z"),
    });
    expect(days.map((d) => d.day)).toEqual(["2099-01-10", "2099-01-11", "2099-01-12"]);
    expect(days[0]?.campaigns.map((c) => [c.id, c.localTime])).toEqual([[london, "23:30"]]);
    expect(days[1]?.campaigns.map((c) => [c.id, c.localTime])).toEqual([
      [madridLate, "00:30"],
      [madridMorning, "08:00"],
    ]);
    expect(days[2]?.campaigns.map((c) => [c.id, c.status])).toEqual([[pausedOne, "paused"]]);
    const morning = days[1]?.campaigns[1];
    expect(morning).toMatchObject({
      name: "Madrid morning",
      country: "ES",
      timezone: "Europe/Madrid",
      status: "scheduled",
      lapsCount: 2,
      smsCount: 500,
    });
    expect(morning?.scheduledAt.toISOString()).toBe("2099-01-11T07:00:00.000Z");
  });
});
