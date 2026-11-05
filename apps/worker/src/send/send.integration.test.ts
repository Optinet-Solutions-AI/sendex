/**
 * End to end: PGlite database + real BullMQ queues on Redis. Runs only when REDIS_URL is
 * set and reachable, like queues.integration.test.ts:
 *
 *   REDIS_URL=redis://127.0.0.1:6379 pnpm --filter @sendex/worker test
 */
import {
  adTexts,
  auditLog,
  campaignLinks,
  campaignSidGroup,
  campaigns,
  contacts,
  createSendingStore,
  getBalanceMicro,
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
} from "@sendex/db";
import { createTestDb, seedOrganisation, type TestDb } from "@sendex/db/test";
import { createProviderRegistry, FakeProvider } from "@sendex/providers";
import { eq } from "drizzle-orm";
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHandlers } from "../handlers.js";
import { createLogger } from "../log.js";
import {
  closeQueues,
  createQueues,
  createWorkers,
  type Queues,
  type WorkerSet,
} from "../queues.js";
import { lapIdempotencyKey, lapJobId } from "./dispatcher.js";
import { createProgressTracker, progressKeys } from "./progress.js";

const redisUrl = process.env.REDIS_URL;

async function redisReachable(url: string): Promise<boolean> {
  const probe = new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    connectTimeout: 1000,
  });
  try {
    await probe.connect();
    return (await probe.ping()) === "PONG";
  } catch {
    return false;
  } finally {
    probe.disconnect();
  }
}

const reachable = redisUrl !== undefined && (await redisReachable(redisUrl));
const quiet = createLogger({ write: () => undefined });

function must<T>(row: T | undefined, what: string): T {
  if (row === undefined) throw new Error(`${what} returned no row`);
  return row;
}

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${what}`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

describe.skipIf(!reachable)("sending engine (integration, needs Redis)", () => {
  let t: TestDb;
  let connection: Redis;
  let queues: Queues;
  let workerSet: WorkerSet;
  let handlers: ReturnType<typeof createHandlers>;
  let org: string;
  let campaignId: string;
  let listId: string;
  let lapId: string;
  const prefix = `sendex-send-test-${process.pid}-${Date.now()}`;
  const meta = { id: "tick", name: "dispatch-laps", attemptsMade: 0 };

  beforeAll(async () => {
    t = await createTestDb();
    connection = new Redis(redisUrl ?? "", { maxRetriesPerRequest: null });
    org = await seedOrganisation(t.db, "integration");

    listId = must(
      (
        await t.db
          .insert(lists)
          .values({ organisationId: org, name: "ES 120", country: "ES", numbersCount: 120 })
          .returning({ id: lists.id })
      )[0],
      "list",
    ).id;
    const contactRows = await t.db
      .insert(contacts)
      .values(
        Array.from({ length: 120 }, (_, i) => ({
          organisationId: org,
          e164: `+3460000${String(i + 1).padStart(4, "0")}`,
          country: "ES",
          firstName: i % 3 === 0 ? `Ana${i}` : null,
        })),
      )
      .returning({ id: contacts.id });
    await t.db
      .insert(listMembers)
      .values(contactRows.map((c) => ({ organisationId: org, listId, contactId: c.id })));

    const routeId = must(
      (
        await t.db
          .insert(routes)
          .values({ provider: "fake", name: "fake-1", country: "ES" })
          .returning({ id: routes.id })
      )[0],
      "route",
    ).id;
    await t.db.insert(routePrices).values({ routeId, country: "ES", priceMicro: 25_000n });

    campaignId = must(
      (
        await t.db
          .insert(campaigns)
          .values({
            organisationId: org,
            name: "Launch",
            country: "ES",
            timezone: "Europe/Madrid",
            status: "sending",
          })
          .returning({ id: campaigns.id })
      )[0],
      "campaign",
    ).id;
    const sidGroupId = must(
      (
        await t.db
          .insert(sidGroups)
          .values({ organisationId: org, name: "ES", country: "ES" })
          .returning({ id: sidGroups.id })
      )[0],
      "sid group",
    ).id;
    await t.db.insert(senderIds).values([
      { organisationId: org, sidGroupId, value: "LUCKY777" },
      { organisationId: org, sidGroupId, value: "BIGSPINS" },
    ]);
    await t.db.insert(campaignSidGroup).values({ campaignId, sidGroupId, organisationId: org });
    await t.db.insert(adTexts).values([
      {
        organisationId: org,
        campaignId,
        text: "Hola {{first_name}}, tu bono: {{domain}}",
        encoding: "GSM_7BIT",
        position: 0,
      },
      {
        organisationId: org,
        campaignId,
        text: "{{phone}}: 50 giros gratis {{domain}}",
        encoding: "GSM_7BIT",
        position: 1,
      },
    ]);
    const linkId = must(
      (
        await t.db
          .insert(links)
          .values({ organisationId: org, name: "offer", url: "https://casino.test/?s={{dynamic}}" })
          .returning({ id: links.id })
      )[0],
      "link",
    ).id;
    await t.db.insert(campaignLinks).values({ campaignId, linkId, organisationId: org });
    await t.db.insert(ledgerEntries).values({
      organisationId: org,
      kind: "deposit",
      amountMicro: 10_000_000n,
      idempotencyKey: "deposit:integration",
    });
    // What the campaign page does: a queued lap plus an audit row, no Redis.
    lapId = must(
      (
        await t.db
          .insert(laps)
          .values({ organisationId: org, campaignId, listId, routeId, testSize: 100 })
          .returning({ id: laps.id })
      )[0],
      "lap",
    ).id;
    await t.db.insert(auditLog).values({
      organisationId: org,
      action: "campaign.send",
      targetType: "campaign",
      targetId: campaignId,
    });

    const store = createSendingStore(t.db);
    queues = createQueues(connection, { prefix, log: quiet });
    handlers = createHandlers({
      log: quiet,
      store,
      providers: createProviderRegistry().register("fake", new FakeProvider({ failEvery: 10 })),
      redis: connection,
      progress: createProgressTracker(connection),
      sendQueue: queues.send,
      send: { linksBaseUrl: "http://localhost:8787" },
    });
    workerSet = createWorkers(connection, handlers, { prefix, log: quiet });
  });

  afterAll(async () => {
    await workerSet.close();
    await Promise.all(
      [...Object.values(queues), ...Object.values(workerSet.deadLetterQueues)].map((q) =>
        q.obliterate({ force: true }),
      ),
    );
    await closeQueues(queues);
    const keys = await connection.keys("sendex:*");
    if (keys.length > 0) await connection.del(...keys);
    await connection.quit();
    await t.close();
  });

  it("dispatches the queued lap and sends it through the fake provider", async () => {
    const completed = new Promise<string | undefined>((resolve) => {
      workerSet.workers.send.on("completed", (job) => {
        if (job.id === lapJobId(lapId)) resolve(job.id);
      });
    });

    await handlers.scheduledSend({ kind: "dispatch-laps" }, meta);
    const [claimed] = await t.db.select().from(laps).where(eq(laps.id, lapId));
    expect(claimed?.status).toBe("sending");
    expect(await withTimeout(completed, 15_000, "the send job")).toBe(lapJobId(lapId));

    const rows = await t.db.select().from(messages).where(eq(messages.lapId, lapId));
    expect(rows).toHaveLength(100);
    expect(rows.filter((m) => m.status === "sent")).toHaveLength(90);
    expect(rows.filter((m) => m.status === "failed")).toHaveLength(10);
    expect(rows.every((m) => m.sentAt !== null || m.status === "failed")).toBe(true);
    expect(rows.every((m) => m.shortCode?.length === 8 && m.dynamicId !== null)).toBe(true);
    expect(new Set(rows.map((m) => m.senderId))).toEqual(new Set(["LUCKY777", "BIGSPINS"]));
    expect(rows.filter((m) => m.text.includes("giros gratis"))).toHaveLength(50);
    expect(rows.every((m) => /http:\/\/localhost:8787\/[2-9a-zA-Z]{8}/.test(m.text))).toBe(true);

    const ledger = await t.db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.organisationId, org));
    expect(ledger.filter((e) => e.kind === "debit")).toHaveLength(100);
    expect(ledger.filter((e) => e.kind === "refund")).toHaveLength(10);
    expect(await getBalanceMicro(t.db, org)).toBe(10_000_000n - 90n * 25_000n);

    const members = await t.db.select().from(listMembers).where(eq(listMembers.listId, listId));
    expect(members.filter((m) => m.sentAt !== null)).toHaveLength(90);

    const [lap] = await t.db.select().from(laps).where(eq(laps.id, lapId));
    expect(lap).toMatchObject({
      status: "done",
      sent: 90,
      failed: 10,
      costMicro: 90n * 25_000n,
      rank: 1,
    });
    expect(lap?.startedAt).toBeInstanceOf(Date);
    expect(lap?.finishedAt).toBeInstanceOf(Date);
    const [list] = await t.db.select().from(lists).where(eq(lists.id, listId));
    expect(list?.lastSentAt).toBeInstanceOf(Date);

    expect(await connection.get(progressKeys.lap(lapId).sent)).toBe("90");
    expect(await connection.get(progressKeys.lap(lapId).failed)).toBe("10");
    expect(await connection.get(progressKeys.lap(lapId).total)).toBe("100");
    expect(await connection.get(progressKeys.campaign(campaignId).sent)).toBe("90");

    const audits = await t.db.select().from(auditLog).where(eq(auditLog.action, "lap.finish"));
    expect(audits).toHaveLength(1);
    expect(audits[0]?.details).toMatchObject({ sent: 90, failed: 10, planned: 100 });
  });

  it("a second dispatcher run enqueues nothing", async () => {
    const before = await queues.send.getJobCounts("waiting", "active", "completed", "delayed");
    await handlers.scheduledSend({ kind: "dispatch-laps" }, meta);
    const after = await queues.send.getJobCounts("waiting", "active", "completed", "delayed");
    expect(after).toEqual(before);
  });

  it("re-running the lap job creates no new messages and charges nothing", async () => {
    const balanceBefore = await getBalanceMicro(t.db, org);
    await handlers.send(
      { organisationId: org, campaignId, lapId, idempotencyKey: lapIdempotencyKey(lapId) },
      { id: "again", name: "send-lap", attemptsMade: 0 },
    );
    const rows = await t.db.select().from(messages).where(eq(messages.lapId, lapId));
    expect(rows).toHaveLength(100);
    expect(await getBalanceMicro(t.db, org)).toBe(balanceBefore);
    const [lap] = await t.db.select().from(laps).where(eq(laps.id, lapId));
    expect(lap).toMatchObject({ status: "done", sent: 90, failed: 10 });
  });
});
