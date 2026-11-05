/**
 * The D2-09 acceptance scenarios against the real SQL store (PGlite) and the real send loop,
 * with no BullMQ: pause at 300 of 1,000 then resume finishes at 1,000 with no duplicates;
 * stop at 300 leaves the other 700 unsent and nothing is sent afterwards.
 */
import {
  adTexts,
  auditLog,
  campaignSidGroup,
  campaigns,
  contacts,
  createSendingStore,
  getBalanceMicro,
  laps,
  ledgerEntries,
  listMembers,
  lists,
  messages,
  pauseCampaign,
  resumeCampaign,
  routePrices,
  routes,
  senderIds,
  sidGroups,
  stopCampaign,
} from "@sendex/db";
import { createTestDb, seedOrganisation, type TestDb } from "@sendex/db/test";
import {
  createProviderRegistry,
  FakeProvider,
  type OutboundMessage,
  type Provider,
  type SubmitOutcome,
} from "@sendex/providers";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SendLapJob } from "../jobs.js";
import { createLogger } from "../log.js";
import { dispatchQueuedLaps } from "./dispatcher.js";
import { createProgressTracker } from "./progress.js";
import { fakeRedis } from "./redis.fake.js";
import { type SendLapDeps, sendLap } from "./send-lap.js";

const quiet = createLogger({ write: () => undefined });
const LIST_SIZE = 1000;
const STOP_AFTER_BATCHES = 6; // 6 x 50 = 300 messages

function must<T>(row: T | undefined, what: string): T {
  if (row === undefined) throw new Error(`${what} returned no row`);
  return row;
}

let t: TestDb;
let org: string;
let routeId: string;
let sidGroupId: string;

/** A provider that runs `afterBatches` once the given number of batches has been submitted. */
function interrupting(afterBatches: number, run: () => Promise<void>): Provider {
  const inner = new FakeProvider();
  let calls = 0;
  return {
    name: "fake",
    async send(batch: readonly OutboundMessage[]): Promise<SubmitOutcome[]> {
      calls += 1;
      const out = await inner.send(batch);
      if (calls === afterBatches) await run();
      return out;
    },
    parseDeliveryReceipt: (raw) => inner.parseDeliveryReceipt(raw),
    priceFor: (route, country) => inner.priceFor(route, country),
    validateSenderId: (senderId, country) => inner.validateSenderId(senderId, country),
  };
}

async function seedCampaign(name: string): Promise<{ campaignId: string; lapId: string }> {
  const listId = must(
    (
      await t.db
        .insert(lists)
        .values({ organisationId: org, name, country: "ES", numbersCount: LIST_SIZE })
        .returning({ id: lists.id })
    )[0],
    "list",
  ).id;
  const prefix = String(Math.floor(Math.random() * 90) + 10);
  const contactRows = await t.db
    .insert(contacts)
    .values(
      Array.from({ length: LIST_SIZE }, (_, i) => ({
        organisationId: org,
        e164: `+346${prefix}${String(i + 1).padStart(6, "0")}`,
        country: "ES",
      })),
    )
    .returning({ id: contacts.id });
  await t.db
    .insert(listMembers)
    .values(contactRows.map((c) => ({ organisationId: org, listId, contactId: c.id })));
  const campaignId = must(
    (
      await t.db
        .insert(campaigns)
        .values({
          organisationId: org,
          name,
          country: "ES",
          timezone: "Europe/Madrid",
          status: "sending",
        })
        .returning({ id: campaigns.id })
    )[0],
    "campaign",
  ).id;
  await t.db.insert(campaignSidGroup).values({ campaignId, sidGroupId, organisationId: org });
  await t.db.insert(adTexts).values({
    organisationId: org,
    campaignId,
    text: "Hola, tu bono te espera",
    encoding: "GSM_7BIT",
    position: 0,
  });
  const lapId = must(
    (
      await t.db
        .insert(laps)
        .values({ organisationId: org, campaignId, listId, routeId, testSize: LIST_SIZE })
        .returning({ id: laps.id })
    )[0],
    "lap",
  ).id;
  return { campaignId, lapId };
}

function depsFor(provider: Provider): SendLapDeps {
  const redis = fakeRedis();
  return {
    store: createSendingStore(t.db),
    providers: createProviderRegistry().register("fake", provider),
    redis,
    progress: createProgressTracker(redis),
    log: quiet,
    linksBaseUrl: "http://localhost:8787",
  };
}

async function sentCount(lapId: string): Promise<number> {
  return (
    await t.db
      .select({ id: messages.id })
      .from(messages)
      .where(and(eq(messages.lapId, lapId), eq(messages.status, "sent")))
  ).length;
}

async function lapRow(lapId: string) {
  return must((await t.db.select().from(laps).where(eq(laps.id, lapId)))[0], "lap");
}

beforeAll(async () => {
  t = await createTestDb();
  org = await seedOrganisation(t.db, "pause-stop");
  routeId = must(
    (
      await t.db
        .insert(routes)
        .values({ provider: "fake", name: "fake-1", country: "ES" })
        .returning({ id: routes.id })
    )[0],
    "route",
  ).id;
  await t.db.insert(routePrices).values({ routeId, country: "ES", priceMicro: 25_000n });
  sidGroupId = must(
    (
      await t.db
        .insert(sidGroups)
        .values({ organisationId: org, name: "ES", country: "ES" })
        .returning({ id: sidGroups.id })
    )[0],
    "sid group",
  ).id;
  await t.db.insert(senderIds).values({ organisationId: org, sidGroupId, value: "LUCKY777" });
  await t.db.insert(ledgerEntries).values({
    organisationId: org,
    kind: "deposit",
    amountMicro: 100_000_000n,
    idempotencyKey: "deposit:pause-stop",
  });
});

afterAll(() => t.close());

describe("pause / resume / stop at 300 of 1,000 (PGlite + real send loop)", () => {
  it("pause at 300, resume: finishes at 1,000 with no duplicates", async () => {
    const { campaignId, lapId } = await seedCampaign("pause at 300");
    const job: SendLapJob = {
      organisationId: org,
      campaignId,
      lapId,
      idempotencyKey: `lap:${lapId}`,
    };
    const store = createSendingStore(t.db);
    expect(
      (await dispatchQueuedLaps({ store, sendQueue: { add: async () => ({}) }, log: quiet }))
        .enqueued,
    ).toBe(1);

    const paused = await sendLap(
      depsFor(
        interrupting(STOP_AFTER_BATCHES, async () => {
          await pauseCampaign(t.db, org, campaignId, { actorUserId: null });
        }),
      ),
      job,
      { id: "1", name: "send-lap", attemptsMade: 0 },
    );
    expect(paused).toEqual({ outcome: "paused", sent: 300, failed: 0 });
    expect(await sentCount(lapId)).toBe(300);
    expect(await lapRow(lapId)).toMatchObject({ status: "sending", sent: 300 });

    // While paused the dispatcher claims nothing and a retry of the job parks again.
    expect((await store.claimQueuedLaps(new Date())).map((l) => l.id)).not.toContain(lapId);
    expect(
      await sendLap(depsFor(new FakeProvider()), job, {
        id: "2",
        name: "send-lap",
        attemptsMade: 1,
      }),
    ).toEqual({ outcome: "paused", sent: 0, failed: 0 });
    expect(await sentCount(lapId)).toBe(300);

    await resumeCampaign(t.db, org, campaignId, { actorUserId: null });
    const resumed = await sendLap(depsFor(new FakeProvider()), job, {
      id: "3",
      name: "send-lap",
      attemptsMade: 2,
    });
    expect(resumed).toEqual({ outcome: "done", sent: 700, failed: 0 });
    expect(await sentCount(lapId)).toBe(1000);
    const all = await t.db
      .select({ contactId: messages.contactId })
      .from(messages)
      .where(eq(messages.lapId, lapId));
    expect(all).toHaveLength(1000);
    expect(new Set(all.map((m) => m.contactId)).size).toBe(1000);
    expect(await lapRow(lapId)).toMatchObject({ status: "done", sent: 1000, failed: 0 });
    expect(await getBalanceMicro(t.db, org)).toBe(100_000_000n - 1000n * 25_000n);
  });

  it("stop at 300: 700 are never sent, the lap is cancelled, nothing goes out after", async () => {
    const { campaignId, lapId } = await seedCampaign("stop at 300");
    const job: SendLapJob = {
      organisationId: org,
      campaignId,
      lapId,
      idempotencyKey: `lap:${lapId}`,
    };
    const store = createSendingStore(t.db);
    await dispatchQueuedLaps({ store, sendQueue: { add: async () => ({}) }, log: quiet });
    const balanceBefore = await getBalanceMicro(t.db, org);

    let stopResult: Awaited<ReturnType<typeof stopCampaign>> | null = null;
    const stopped = await sendLap(
      depsFor(
        interrupting(STOP_AFTER_BATCHES, async () => {
          stopResult = await stopCampaign(t.db, org, campaignId, { actorUserId: null });
        }),
      ),
      job,
      { id: "1", name: "send-lap", attemptsMade: 0 },
    );
    expect(stopped).toEqual({
      outcome: "cancelled",
      sent: 300,
      failed: 0,
      reason: "campaign stopped",
    });
    // The helper cancelled the lap itself; the batch in flight had already been submitted.
    expect(stopResult).toEqual({ status: "stopped", cancelledLaps: 1, cancelledMessages: 0 });
    expect(await sentCount(lapId)).toBe(300);
    const lap = await lapRow(lapId);
    expect(lap).toMatchObject({ status: "cancelled", sent: 300 });
    expect(lap.testSize - lap.sent).toBe(700);
    expect(lap.finishedAt).toBeInstanceOf(Date);
    expect(await getBalanceMicro(t.db, org)).toBe(balanceBefore - 300n * 25_000n);

    // Nothing is sent afterwards: the job is a no-op and the dispatcher ignores the campaign.
    const again = await sendLap(depsFor(new FakeProvider()), job, {
      id: "2",
      name: "send-lap",
      attemptsMade: 1,
    });
    expect(again).toEqual({ outcome: "skipped", sent: 0, failed: 0, reason: "cancelled" });
    expect(await sentCount(lapId)).toBe(300);
    expect((await store.claimQueuedLaps(new Date())).map((l) => l.campaignId)).not.toContain(
      campaignId,
    );

    // Exactly one lap.cancel row, from the stop helper, even though the loop cancelled too.
    const cancels = await t.db
      .select({ details: auditLog.details })
      .from(auditLog)
      .where(and(eq(auditLog.action, "lap.cancel"), eq(auditLog.targetId, lapId)));
    expect(cancels).toEqual([{ details: { reason: "campaign stopped", cancelledMessages: 0 } }]);
  });
});
