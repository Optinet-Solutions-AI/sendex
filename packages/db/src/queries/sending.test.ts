import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  adTexts,
  auditLog,
  campaignLinks,
  campaignSidGroup,
  campaigns,
  contacts,
  laps,
  ledgerEntries,
  links,
  listMembers,
  lists,
  messages,
  routePrices,
  routes,
  senderIds,
  sidGroups,
  suppressions,
} from "../schema/index.js";
import { createTestDb, seedOrganisation, type TestDb } from "../test/db.js";
import { getBalanceMicro } from "./ledger.js";
import { createSegment, deleteSegment } from "./segments.js";
import { createSendingStore, type SendingStore } from "./sending.js";

let t: TestDb;
let store: SendingStore;
let org: string;
let otherOrg: string;
let listId: string;
let campaignId: string;
let otherCampaignId: string;
let routeId: string;
let lapId: string;

const contactIds: Record<string, string> = {};
const memberIds: Record<string, string> = {};

const T0 = new Date("2026-10-01T00:00:00Z");
const T1 = new Date("2026-10-02T00:00:00Z");
const T2 = new Date("2026-10-03T00:00:00Z");

function must<T>(row: T | undefined, what: string): T {
  if (row === undefined) throw new Error(`${what} returned no row`);
  return row;
}

async function addContact(
  key: string,
  e164: string,
  member: Partial<typeof listMembers.$inferInsert> = {},
): Promise<void> {
  const contact = must(
    (
      await t.db
        .insert(contacts)
        .values({ organisationId: org, e164, country: "ES", firstName: key })
        .returning({ id: contacts.id })
    )[0],
    "contact",
  );
  const m = must(
    (
      await t.db
        .insert(listMembers)
        .values({ organisationId: org, listId, contactId: contact.id, ...member })
        .returning({ id: listMembers.id })
    )[0],
    "member",
  );
  contactIds[key] = contact.id;
  memberIds[key] = m.id;
}

async function addMessage(
  campaign: string,
  lap: string,
  contactKey: string,
  status: "queued" | "sent" | "delivered" | "failed" | "cancelled",
  sentAt: Date | null,
  idempotencyKey: string,
  organisationId = org,
): Promise<string> {
  const row = must(
    (
      await t.db
        .insert(messages)
        .values({
          organisationId,
          campaignId: campaign,
          lapId: lap,
          contactId: contactIds[contactKey] ?? "",
          routeId,
          e164: "+34600000000",
          senderId: "LUCKY777",
          text: "x",
          encoding: "GSM_7BIT",
          parts: 1,
          status,
          sentAt,
          idempotencyKey,
        })
        .returning({ id: messages.id })
    )[0],
    "message",
  );
  return row.id;
}

beforeAll(async () => {
  t = await createTestDb();
  store = createSendingStore(t.db);
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
  await t.db.insert(routePrices).values([
    { routeId, country: "ES", priceMicro: 30_000n, validFrom: T0 },
    { routeId, country: "ES", priceMicro: 25_000n, validFrom: T1 },
    { routeId, country: "ES", priceMicro: 99_000n, validFrom: new Date("2099-01-01T00:00:00Z") },
    { routeId, country: "FR", priceMicro: 36_000n, validFrom: T0 },
  ]);

  const insertCampaign = async (name: string) =>
    must(
      (
        await t.db
          .insert(campaigns)
          .values({ organisationId: org, name, country: "ES", timezone: "Europe/Madrid" })
          .returning({ id: campaigns.id })
      )[0],
      "campaign",
    ).id;
  campaignId = await insertCampaign("c1");
  otherCampaignId = await insertCampaign("c2");

  const sidGroupId = must(
    (
      await t.db
        .insert(sidGroups)
        .values({ organisationId: org, name: "ES sids", country: "ES" })
        .returning({ id: sidGroups.id })
    )[0],
    "sid group",
  ).id;
  await t.db.insert(senderIds).values([
    { organisationId: org, sidGroupId, value: "LUCKY777" },
    { organisationId: org, sidGroupId, value: "OLDSID", active: false },
    { organisationId: org, sidGroupId, value: "BIGSPINS" },
  ]);
  await t.db.insert(campaignSidGroup).values({ campaignId, sidGroupId, organisationId: org });
  await t.db.insert(adTexts).values([
    { organisationId: org, campaignId, text: "second", encoding: "GSM_7BIT", position: 2 },
    { organisationId: org, campaignId, text: "first", encoding: "GSM_7BIT", position: 1 },
    {
      organisationId: org,
      campaignId,
      text: "off",
      encoding: "GSM_7BIT",
      position: 0,
      active: false,
    },
  ]);
  const linkId = must(
    (
      await t.db
        .insert(links)
        .values({ organisationId: org, name: "offer", url: "https://x.test/?s={{dynamic}}" })
        .returning({ id: links.id })
    )[0],
    "link",
  ).id;
  await t.db.insert(campaignLinks).values({ campaignId, linkId, organisationId: org });

  lapId = must(
    (
      await t.db
        .insert(laps)
        .values({ organisationId: org, campaignId, listId, routeId, testSize: 10 })
        .returning({ id: laps.id })
    )[0],
    "lap",
  ).id;

  // Eligible: never sent, flushed after send.
  await addContact("fresh", "+34600000001");
  await addContact("flushed", "+34600000002", { sentAt: T0, flushedAt: T1 });
  // Excluded by list state.
  await addContact("sent", "+34600000003", { sentAt: T1 });
  await addContact("sentAfterFlush", "+34600000004", { sentAt: T2, flushedAt: T1 });
  await addContact("bad", "+34600000005", { bad: true, badReason: "invalid" });
  // Excluded by suppression (own organisation only).
  await addContact("suppressed", "+34600000006");
  await addContact("suppressedElsewhere", "+34600000007");
  await t.db.insert(suppressions).values([
    { organisationId: org, e164: "+34600000006", reason: "unsubscribe", source: "sms" },
    { organisationId: otherOrg, e164: "+34600000007", reason: "unsubscribe", source: "sms" },
  ]);
  // Contact reuse: messaged by another campaign of the organisation.
  await addContact("reusedSent", "+34600000008");
  await addContact("reusedDelivered", "+34600000009");
  await addContact("reusedFailed", "+34600000010");
  await addContact("reusedBeforeFlush", "+34600000011", { flushedAt: T2 });
  await addContact("inThisCampaign", "+34600000012");
  const otherLap = must(
    (
      await t.db
        .insert(laps)
        .values({
          organisationId: org,
          campaignId: otherCampaignId,
          listId,
          routeId,
          testSize: 1,
          status: "done",
        })
        .returning({ id: laps.id })
    )[0],
    "lap",
  ).id;
  await addMessage(otherCampaignId, otherLap, "reusedSent", "sent", T1, "k1");
  await addMessage(otherCampaignId, otherLap, "reusedDelivered", "delivered", T1, "k2");
  await addMessage(otherCampaignId, otherLap, "reusedFailed", "failed", null, "k3");
  await addMessage(otherCampaignId, otherLap, "reusedBeforeFlush", "sent", T1, "k4");
  await addMessage(campaignId, lapId, "inThisCampaign", "queued", null, "k5");
});

afterAll(async () => {
  await t.close();
});

const eligibility = () => ({
  organisationId: org,
  listId,
  campaignId,
  contactReuse: "account_wide" as const,
});

describe("selectEligibleMembers", () => {
  it("account_wide: keeps fresh and flushed members, drops every exclusion", async () => {
    const rows = await store.selectEligibleMembers(eligibility(), 100);
    const keys = rows.map((r) => r.firstName).sort();
    expect(keys).toEqual([
      "flushed",
      "fresh",
      "reusedBeforeFlush",
      "reusedFailed",
      "suppressedElsewhere",
    ]);
    const fresh = rows.find((r) => r.firstName === "fresh");
    expect(fresh).toEqual({
      memberId: memberIds.fresh,
      contactId: contactIds.fresh,
      e164: "+34600000001",
      firstName: "fresh",
      lastName: null,
    });
  });

  it("per_campaign: ignores sends by other campaigns but not by this one", async () => {
    const rows = await store.selectEligibleMembers(
      { ...eligibility(), contactReuse: "per_campaign" },
      100,
    );
    expect(rows.map((r) => r.firstName).sort()).toEqual([
      "flushed",
      "fresh",
      "reusedBeforeFlush",
      "reusedDelivered",
      "reusedFailed",
      "reusedSent",
      "suppressedElsewhere",
    ]);
  });

  it("honours the limit in a stable order and counts the same set", async () => {
    const all = await store.selectEligibleMembers(eligibility(), 100);
    const two = await store.selectEligibleMembers(eligibility(), 2);
    expect(two).toEqual(all.slice(0, 2));
    expect(await store.countEligibleMembers(eligibility())).toBe(5);
  });

  it("counts the skipped members by reason", async () => {
    // bad: 1; already sent (not flushed since): sent, sentAfterFlush; suppressed: 1;
    // reused: reusedSent, reusedDelivered (account-wide) and inThisCampaign.
    expect(await store.countSkipReasons(eligibility())).toEqual({
      bad: 1,
      alreadySent: 2,
      suppressed: 1,
      reused: 3,
    });
    expect(
      await store.countSkipReasons({ ...eligibility(), contactReuse: "per_campaign" }),
    ).toMatchObject({ reused: 1 });
  });

  it("sees nothing for another organisation's list", async () => {
    expect(
      await store.selectEligibleMembers({ ...eligibility(), organisationId: otherOrg }, 10),
    ).toEqual([]);
  });
});

describe("loadLapContext", () => {
  it("loads lap, campaign, list, route, rotation inputs and the current price", async () => {
    const ctx = await store.loadLapContext(lapId);
    expect(ctx).not.toBeNull();
    if (!ctx) return;
    expect(ctx.lap).toMatchObject({ id: lapId, status: "queued", testSize: 10, costMicro: 0n });
    expect(ctx.campaign).toMatchObject({
      id: campaignId,
      status: "draft",
      contactReuse: "account_wide",
    });
    expect(ctx.list).toEqual({ id: listId, country: "ES" });
    expect(ctx.route).toMatchObject({ id: routeId, provider: "fake", name: "fake-1" });
    expect(ctx.senderIds).toEqual(["BIGSPINS", "LUCKY777"]);
    expect(ctx.texts.map((x) => x.text)).toEqual(["first", "second"]);
    expect(ctx.link?.url).toBe("https://x.test/?s={{dynamic}}");
    // Latest valid_from not in the future: 25_000, not the 2099 row nor the FR row.
    expect(ctx.priceMicro).toBe(25_000n);
  });

  it("returns null for an unknown lap", async () => {
    expect(await store.loadLapContext("00000000-0000-0000-0000-000000000000")).toBeNull();
  });

  it("getCurrentPriceMicro returns null when no price applies", async () => {
    expect(await store.getCurrentPriceMicro(routeId, "GB")).toBeNull();
    expect(await store.getCurrentPriceMicro(routeId, "FR")).toBe(36_000n);
  });
});

describe("claimAndCreateMessages / applyOutcomes", () => {
  it("inserts messages with their debits in one transaction and is idempotent", async () => {
    await t.db.insert(ledgerEntries).values({
      organisationId: org,
      kind: "deposit",
      amountMicro: 1_000_000n,
      idempotencyKey: "deposit:test",
    });
    const lap = { id: lapId, organisationId: org, campaignId, listId, routeId };
    const build = (members: Array<{ contactId: string; e164: string }>) =>
      members.map((m, i) => ({
        contactId: m.contactId,
        e164: m.e164,
        senderId: "LUCKY777",
        text: `hello ${i}`,
        encoding: "GSM_7BIT",
        parts: i === 0 ? 2 : 1,
        shortCode: `code${i}`,
        dynamicId: `dyn-${m.contactId}`,
      }));

    const created = await store.claimAndCreateMessages({
      lap,
      eligibility: eligibility(),
      limit: 2,
      priceMicro: 25_000n,
      build,
    });
    expect(created).toHaveLength(2);
    expect(created[0]).toMatchObject({ parts: 2, senderId: "LUCKY777", text: "hello 0" });
    const inserted = await t.db.select().from(messages).where(eq(messages.lapId, lapId));
    // k5 from the setup plus the two new ones.
    expect(inserted).toHaveLength(3);
    const byKey = inserted.filter((m) => m.idempotencyKey === `${lapId}:${created[0]?.contactId}`);
    expect(byKey).toHaveLength(1);
    expect(byKey[0]).toMatchObject({ status: "queued", shortCode: "code0", parts: 2 });

    const debits = await t.db.select().from(ledgerEntries).where(eq(ledgerEntries.kind, "debit"));
    expect(debits.map((d) => d.amountMicro).sort()).toEqual([-50_000n, -25_000n].sort());
    expect(debits.map((d) => d.idempotencyKey).sort()).toEqual(
      created.map((c) => `msg:${c.id}`).sort(),
    );
    expect(await getBalanceMicro(t.db, org)).toBe(925_000n);

    // The same members are now excluded (they have a message in this lap), so the next claim
    // takes the remaining eligible ones; and the claimed ones are never duplicated.
    const more = await store.claimAndCreateMessages({
      lap,
      eligibility: eligibility(),
      limit: 10,
      priceMicro: 25_000n,
      build,
    });
    expect(more).toHaveLength(3);
    expect(new Set([...created, ...more].map((m) => m.contactId)).size).toBe(5);
    expect(await store.countLapMessages(lapId)).toBe(6);
    // Three more messages, the first of them two parts: 4 parts at 25_000.
    expect(await getBalanceMicro(t.db, org)).toBe(825_000n);

    // Nothing left: a further claim creates nothing and charges nothing.
    expect(
      await store.claimAndCreateMessages({
        lap,
        eligibility: eligibility(),
        limit: 10,
        priceMicro: 25_000n,
        build,
      }),
    ).toEqual([]);
    expect(await getBalanceMicro(t.db, org)).toBe(825_000n);
  });

  it("applies outcomes: sent marks the member, failed refunds the debit exactly once", async () => {
    const queued = await store.listQueuedMessages(lapId);
    expect(queued).toHaveLength(6);
    const [a, b] = queued;
    if (!a || !b) throw new Error("expected queued messages");
    const lap = { id: lapId, organisationId: org, listId };
    const [memberBBefore] = await t.db
      .select()
      .from(listMembers)
      .where(eq(listMembers.contactId, b.contactId));
    const outcomes = [
      {
        messageId: a.id,
        contactId: a.contactId,
        parts: a.parts,
        status: "sent" as const,
        providerMessageId: "p-1",
      },
      {
        messageId: b.id,
        contactId: b.contactId,
        parts: b.parts,
        status: "failed" as const,
        errorCode: "FAKE_REJECTED",
      },
    ];
    await store.applyOutcomes({ lap, priceMicro: 25_000n, outcomes });
    await store.applyOutcomes({ lap, priceMicro: 25_000n, outcomes });

    const [ma] = await t.db.select().from(messages).where(eq(messages.id, a.id));
    expect(ma).toMatchObject({ status: "sent", providerMessageId: "p-1" });
    expect(ma?.sentAt).toBeInstanceOf(Date);
    const [mb] = await t.db.select().from(messages).where(eq(messages.id, b.id));
    expect(mb).toMatchObject({ status: "failed", errorCode: "FAKE_REJECTED" });

    const [memberA] = await t.db
      .select()
      .from(listMembers)
      .where(eq(listMembers.contactId, a.contactId));
    expect(memberA?.sentAt).toBeInstanceOf(Date);
    const [memberB] = await t.db
      .select()
      .from(listMembers)
      .where(eq(listMembers.contactId, b.contactId));
    // A failed send leaves the member's sent_at as it was.
    expect(memberB?.sentAt).toEqual(memberBBefore?.sentAt ?? null);

    const refunds = await t.db.select().from(ledgerEntries).where(eq(ledgerEntries.kind, "refund"));
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({
      idempotencyKey: `refund:${b.id}`,
      amountMicro: BigInt(b.parts) * 25_000n,
    });

    const [lapRow] = await t.db.select().from(laps).where(eq(laps.id, lapId));
    // k5 was not created through the store but is queued; its contact is "inThisCampaign".
    expect(lapRow).toMatchObject({ sent: 1, failed: 1, costMicro: BigInt(a.parts) * 25_000n });
  });

  it("cancelLap cancels the queued messages, refunds them and audits the reason", async () => {
    const before = await getBalanceMicro(t.db, org);
    const queuedBefore = await store.listQueuedMessages(lapId);
    expect(queuedBefore).toHaveLength(4);
    const refundable = queuedBefore.filter((m) => m.idempotencyKey !== "k5");
    await store.cancelLap({ lapId, organisationId: org, reason: "campaign stopped" });
    await store.cancelLap({ lapId, organisationId: org, reason: "campaign stopped" });

    expect(await store.listQueuedMessages(lapId)).toEqual([]);
    const [lapRow] = await t.db.select().from(laps).where(eq(laps.id, lapId));
    expect(lapRow?.status).toBe("cancelled");
    expect(lapRow?.finishedAt).toBeInstanceOf(Date);
    const refunded = refundable.reduce((sum, m) => sum + BigInt(m.parts) * 25_000n, 0n);
    expect(await getBalanceMicro(t.db, org)).toBe(before + refunded);
    const audits = await t.db.select().from(auditLog).where(eq(auditLog.action, "lap.cancel"));
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ targetType: "lap", targetId: lapId });
    expect(audits[0]?.details).toMatchObject({ reason: "campaign stopped" });
  });
});

describe("claimQueuedLaps and lap lifecycle", () => {
  let readyLap: string;
  let futureLap: string;
  let pausedLap: string;

  beforeAll(async () => {
    const scheduled = must(
      (
        await t.db
          .insert(campaigns)
          .values({
            organisationId: org,
            name: "later",
            country: "ES",
            timezone: "Europe/Madrid",
            status: "scheduled",
            scheduledAt: new Date("2099-01-01T00:00:00Z"),
          })
          .returning({ id: campaigns.id })
      )[0],
      "campaign",
    ).id;
    const paused = must(
      (
        await t.db
          .insert(campaigns)
          .values({
            organisationId: org,
            name: "paused",
            country: "ES",
            timezone: "Europe/Madrid",
            status: "paused",
          })
          .returning({ id: campaigns.id })
      )[0],
      "campaign",
    ).id;
    const insertLap = async (campaign: string) =>
      must(
        (
          await t.db
            .insert(laps)
            .values({ organisationId: org, campaignId: campaign, listId, routeId, testSize: 5 })
            .returning({ id: laps.id })
        )[0],
        "lap",
      ).id;
    readyLap = await insertLap(campaignId);
    futureLap = await insertLap(scheduled);
    pausedLap = await insertLap(paused);
  });

  it("claims only queued laps of sendable campaigns, once", async () => {
    const claimed = await store.claimQueuedLaps(new Date());
    expect(claimed.map((l) => l.id)).toEqual([readyLap]);
    expect(claimed[0]).toMatchObject({ organisationId: org, campaignId });
    expect(await store.claimQueuedLaps(new Date())).toEqual([]);
    const [row] = await t.db.select().from(laps).where(eq(laps.id, readyLap));
    expect(row?.status).toBe("sending");
    for (const id of [futureLap, pausedLap]) {
      const [other] = await t.db.select().from(laps).where(eq(laps.id, id));
      expect(other?.status).toBe("queued");
    }
  });

  it("claims a scheduled lap once its time has come, and unclaim puts it back", async () => {
    const claimed = await store.claimQueuedLaps(new Date("2099-01-02T00:00:00Z"));
    expect(claimed.map((l) => l.id)).toEqual([futureLap]);
    await store.unclaimLap(futureLap);
    const [row] = await t.db.select().from(laps).where(eq(laps.id, futureLap));
    expect(row?.status).toBe("queued");
    expect(
      (await store.claimQueuedLaps(new Date("2099-01-02T00:00:00Z"))).map((l) => l.id),
    ).toEqual([futureLap]);
  });

  it("marks a lap started and finished, and ranks the campaign's finished laps", async () => {
    await store.markLapStarted(readyLap);
    const [started] = await t.db.select().from(laps).where(eq(laps.id, readyLap));
    expect(started?.startedAt).toBeInstanceOf(Date);
    await t.db
      .update(laps)
      .set({ sent: 10, clicks: 2, costMicro: 250_000n })
      .where(eq(laps.id, readyLap));
    const finish = () =>
      store.finishLap({
        lapId: readyLap,
        organisationId: org,
        listId,
        details: { sent: 10, failed: 0, skipped: { bad: 1 } },
      });
    await finish();
    await finish();
    const [done] = await t.db.select().from(laps).where(eq(laps.id, readyLap));
    expect(done?.status).toBe("done");
    expect(done?.finishedAt).toBeInstanceOf(Date);
    const [list] = await t.db.select().from(lists).where(eq(lists.id, listId));
    expect(list?.lastSentAt).toBeInstanceOf(Date);
    const audits = await t.db.select().from(auditLog).where(eq(auditLog.action, "lap.finish"));
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      targetId: readyLap,
      details: { sent: 10, skipped: { bad: 1 } },
    });

    // The cancelled lap from before (sent 1) is not ranked; only done laps are.
    await store.rankCampaignLaps(campaignId);
    const ranked = await t.db.select().from(laps).where(eq(laps.campaignId, campaignId));
    expect(ranked.find((l) => l.id === readyLap)?.rank).toBe(1);
    expect(ranked.find((l) => l.id === lapId)?.rank).toBeNull();
  });

  it("getCampaignStatus and listCampaignLaps", async () => {
    expect(await store.getCampaignStatus(campaignId)).toBe("draft");
    expect(await store.getCampaignStatus("00000000-0000-0000-0000-000000000000")).toBeNull();
    const rows = await store.listCampaignLaps(org, campaignId);
    expect(rows.map((r) => r.id).sort()).toEqual([lapId, readyLap].sort());
    expect(rows.find((r) => r.id === readyLap)).toMatchObject({
      status: "done",
      testSize: 5,
      sent: 10,
    });
    expect(await store.listCampaignLaps(otherOrg, campaignId)).toEqual([]);
  });

  it("createQueuedLap inserts a queued lap with an audit row", async () => {
    const lap = await store.createQueuedLap({
      organisationId: org,
      campaignId,
      listId,
      routeId,
      testSize: 7,
      details: { mode: "finish", priceMicro: "25000" },
    });
    expect(lap).toMatchObject({ status: "queued", testSize: 7, campaignId, listId, routeId });
    const audits = await t.db.select().from(auditLog).where(eq(auditLog.action, "lap.create"));
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      targetId: lap.id,
      details: { mode: "finish", priceMicro: "25000" },
    });
  });

  it("loadLapPlanningContext resolves the campaign, list and route of an organisation", async () => {
    const ctx = await store.loadLapPlanningContext({
      organisationId: org,
      campaignId,
      listId,
      routeId,
    });
    expect(ctx.campaign?.contactReuse).toBe("account_wide");
    expect(ctx.list?.country).toBe("ES");
    expect(ctx.route?.id).toBe(routeId);
    const foreign = await store.loadLapPlanningContext({
      organisationId: otherOrg,
      campaignId,
      listId,
      routeId,
    });
    expect(foreign.campaign).toBeNull();
    expect(foreign.list).toBeNull();
    // Platform routes (organisation_id null) are visible to every organisation.
    expect(foreign.route?.id).toBe(routeId);
  });
});

describe("segments at send time", () => {
  it("a lap's segment narrows the list and a global exclude keeps contacts off every lap", async () => {
    // A list of its own: earlier tests claim the shared list's members in no fixed order.
    const segList = must(
      (
        await t.db
          .insert(lists)
          .values({ organisationId: org, name: "Segment list", country: "ES" })
          .returning({ id: lists.id })
      )[0],
      "list",
    ).id;
    for (const [name, e164] of [
      ["seg-keep", "+34611100001"],
      ["seg-drop", "+34611100002"],
    ] as const) {
      const contact = must(
        (
          await t.db
            .insert(contacts)
            .values({ organisationId: org, e164, country: "ES", firstName: name })
            .returning({ id: contacts.id })
        )[0],
        "contact",
      );
      await t.db
        .insert(listMembers)
        .values({ organisationId: org, listId: segList, contactId: contact.id });
    }
    const scope = { ...eligibility(), listId: segList };
    const names = (list: Array<{ firstName: string | null }>) =>
      list.map((r) => r.firstName ?? "").sort();

    const onlyKeep = await createSegment(t.db, org, {
      name: "Keep only",
      definition: {
        id: "g",
        op: "and",
        rules: [{ id: "r", field: "first_name", operator: "equals", value: "seg-keep" }],
      },
      isTemplate: false,
      globalExclude: false,
    });
    const narrowed = await store.selectEligibleMembers({ ...scope, segmentId: onlyKeep.id }, 100);
    expect(names(narrowed)).toEqual(["seg-keep"]);
    expect(await store.countEligibleMembers({ ...scope, segmentId: onlyKeep.id })).toBe(1);

    const exclude = await createSegment(t.db, org, {
      name: "Never seg-drop",
      definition: {
        id: "g",
        op: "and",
        rules: [{ id: "r", field: "first_name", operator: "equals", value: "seg-drop" }],
      },
      isTemplate: false,
      globalExclude: true,
    });
    expect(names(await store.selectEligibleMembers(scope, 100))).toEqual(["seg-keep"]);
    const skips = await store.countSkipReasons(scope);
    expect(skips.suppressed).toBe(1);

    await deleteSegment(t.db, org, exclude.id);
    await deleteSegment(t.db, org, onlyKeep.id);
    expect(names(await store.selectEligibleMembers(scope, 100))).toEqual(["seg-drop", "seg-keep"]);
  });
});
