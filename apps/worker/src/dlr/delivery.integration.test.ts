/**
 * Delivery receipts end to end (D3-01) and click counting (D2-13): PGlite + the in-process
 * SMPP simulator, no Redis. A lap of 100 goes through `SmppProvider`; the simulator answers
 * every submit and sends a receipt per message, UNDELIV for the five numbers ending in 98.
 * The receipts are enqueued the way `index.ts` wires them and fed to the dlr handler.
 */
import {
  adTexts,
  campaignLinks,
  campaignSidGroup,
  campaigns,
  clickStats,
  contacts,
  createSendingStore,
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
import {
  createProviderRegistry,
  SmppProvider,
  type SmppSimulator,
  startSimulator,
} from "@sendex/providers";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHandlers } from "../handlers.js";
import type { DlrJob } from "../jobs.js";
import { ingestClicks } from "../links/ingest.js";
import { createLogger } from "../log.js";
import { createProgressTracker } from "../send/progress.js";
import { fakeRedis } from "../send/redis.fake.js";
import { subscribeDeliveryReceipts } from "./subscribe.js";

const quiet = createLogger({ write: () => undefined });

function must<T>(row: T | undefined, what: string): T {
  if (row === undefined) throw new Error(`${what} returned no row`);
  return row;
}

async function waitFor(check: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("timed out waiting for condition");
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe("delivery receipts through the SMPP simulator", () => {
  let t: TestDb;
  let sim: SmppSimulator;
  let provider: SmppProvider;
  let handlers: ReturnType<typeof createHandlers>;
  let org: string;
  let campaignId: string;
  let lapId: string;
  const receipts: DlrJob[] = [];

  beforeAll(async () => {
    t = await createTestDb();
    sim = await startSimulator({ behaviour: { receiptDelayMs: 5 } });
    provider = new SmppProvider({
      name: "23telecom",
      host: "127.0.0.1",
      port: sim.port,
      systemId: "test",
      password: "test",
      prices: {},
      windowSize: 20,
      session: { connectTimeoutMs: 2_000, bindTimeoutMs: 5_000, submitTimeoutMs: 5_000 },
    });
    const providers = createProviderRegistry().register("smpp", provider);
    subscribeDeliveryReceipts({
      registry: providers,
      enqueue: async (job) => {
        receipts.push(job);
      },
      log: quiet,
    });

    org = await seedOrganisation(t.db, "delivery");
    const listId = must(
      (
        await t.db
          .insert(lists)
          .values({ organisationId: org, name: "ES 100", country: "ES", numbersCount: 100 })
          .returning({ id: lists.id })
      )[0],
      "list",
    ).id;
    // Five numbers end in 98: the simulator accepts them and then reports UNDELIV.
    const numbers = Array.from({ length: 100 }, (_, i) =>
      i < 5 ? `+34600${String(i).padStart(4, "0")}98` : `+34600${String(i).padStart(4, "0")}01`,
    );
    const contactRows = await t.db
      .insert(contacts)
      .values(numbers.map((e164) => ({ organisationId: org, e164, country: "ES" })))
      .returning({ id: contacts.id });
    await t.db
      .insert(listMembers)
      .values(contactRows.map((c) => ({ organisationId: org, listId, contactId: c.id })));
    const routeId = must(
      (
        await t.db
          .insert(routes)
          .values({ provider: "smpp", name: "23t-premium", country: "ES" })
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
            name: "Delivery",
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
    await t.db.insert(senderIds).values({ organisationId: org, sidGroupId, value: "BIGSPINS" });
    await t.db.insert(campaignSidGroup).values({ campaignId, sidGroupId, organisationId: org });
    await t.db.insert(adTexts).values({
      organisationId: org,
      campaignId,
      text: "Hola, tu bono: {{domain}}",
      encoding: "GSM_7BIT",
      position: 0,
    });
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
      idempotencyKey: "deposit:delivery",
    });
    lapId = must(
      (
        await t.db
          .insert(laps)
          .values({ organisationId: org, campaignId, listId, routeId, testSize: 100 })
          .returning({ id: laps.id })
      )[0],
      "lap",
    ).id;

    const redis = fakeRedis();
    handlers = createHandlers({
      log: quiet,
      db: t.db,
      store: createSendingStore(t.db),
      providers,
      redis,
      progress: createProgressTracker(redis),
      sendQueue: { add: async () => undefined },
      send: { linksBaseUrl: "http://localhost:8787" },
    });
  });

  afterAll(async () => {
    await provider.close();
    await sim.close();
    await t.close();
  });

  it("sends 100, receives 100 receipts and the lap shows 95 delivered, 5 failed", async () => {
    await handlers.scheduledSend(
      { kind: "dispatch-laps" },
      { id: "t", name: "tick", attemptsMade: 0 },
    );
    await handlers.send(
      { organisationId: org, campaignId, lapId, idempotencyKey: `lap:${lapId}` },
      { id: "s", name: "send-lap", attemptsMade: 0 },
    );
    let [lap] = await t.db.select().from(laps).where(eq(laps.id, lapId));
    expect(lap).toMatchObject({ status: "done", sent: 100, failed: 0, delivered: 0 });

    await waitFor(() => receipts.length === 100);
    // Every receipt names the registry provider and carries no phone number.
    expect(receipts.every((r) => r.provider === "smpp")).toBe(true);
    expect(JSON.stringify(receipts)).not.toContain("3460000");

    // The dlr worker: a receipt that arrives before its outcome is stored is retried.
    for (const [i, job] of receipts.entries()) {
      for (let attempt = 0; ; attempt += 1) {
        try {
          await handlers.dlr(JSON.parse(JSON.stringify(job)) as DlrJob, {
            id: `r-${i}`,
            name: "receipt",
            attemptsMade: attempt,
          });
          break;
        } catch (err) {
          if (attempt >= 2) throw err;
        }
      }
    }

    const rows = await t.db.select().from(messages).where(eq(messages.lapId, lapId));
    expect(rows).toHaveLength(100);
    const delivered = rows.filter((m) => m.status === "delivered");
    const failed = rows.filter((m) => m.status === "failed");
    expect(delivered).toHaveLength(95);
    expect(failed).toHaveLength(5);
    expect(delivered.every((m) => m.deliveredAt instanceof Date)).toBe(true);
    expect(failed.every((m) => m.errorCode === "001" && m.e164.endsWith("98"))).toBe(true);
    expect(rows.every((m) => m.adTextId !== null && m.linkId !== null)).toBe(true);

    [lap] = await t.db.select().from(laps).where(eq(laps.id, lapId));
    expect(lap).toMatchObject({ sent: 100, delivered: 95, failed: 5 });

    // A replay of every receipt changes nothing.
    for (const job of receipts) {
      await handlers.dlr(job, { id: "again", name: "receipt", attemptsMade: 0 });
    }
    [lap] = await t.db.select().from(laps).where(eq(laps.id, lapId));
    expect(lap).toMatchObject({ sent: 100, delivered: 95, failed: 5 });
  });

  it("counts a clicked message once: 5 clickers on 100 sent is 5.00 % CTR", async () => {
    const rows = await t.db
      .select({ shortCode: messages.shortCode })
      .from(messages)
      .where(eq(messages.lapId, lapId))
      .limit(5);
    const codes = rows.flatMap((r) => (r.shortCode === null ? [] : [r.shortCode]));
    expect(codes).toHaveLength(5);
    const click = (shortCode: string, second: number) => ({
      shortCode,
      clickedAt: `2026-11-06T10:00:${String(second).padStart(2, "0")}.000Z`,
      ip: "203.0.113.9",
      userAgent: "Mozilla/5.0 (iPhone)",
    });
    const first = codes[0] ?? "";
    await handlers.clickIngest(
      { clicks: [...codes.map((c, i) => click(c, i)), click(first, 10), click(first, 11)] },
      { id: "c", name: "clicks", attemptsMade: 0 },
    );
    await ingestClicks(t.db, { clicks: [click(first, 12)] });

    const [lap] = await t.db.select().from(laps).where(eq(laps.id, lapId));
    expect(lap?.clicks).toBe(5);
    const stats = await clickStats(t.db, org, campaignId);
    expect(stats?.campaign).toMatchObject({
      sent: 100,
      delivered: 95,
      clicks: 5,
      rawClicks: 8,
      ctr: 0.05,
      cpcMicro: 500_000,
      deliveryRate: 0.95,
    });
    expect(stats?.laps[0]).toMatchObject({
      key: lapId,
      label: "23t-premium",
      clicks: 5,
      ctr: 0.05,
    });
    expect(stats?.senderIds).toHaveLength(1);
    expect(stats?.senderIds[0]).toMatchObject({ key: "BIGSPINS", sent: 100, clicks: 5, ctr: 0.05 });
    expect(stats?.adTexts[0]).toMatchObject({ label: "Hola, tu bono: {{domain}}", clicks: 5 });
    expect(stats?.links[0]).toMatchObject({ label: "offer", sent: 100, clicks: 5 });
  });
});
