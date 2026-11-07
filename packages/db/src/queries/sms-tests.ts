import type { SmsTestInput } from "@sendex/core";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { ledgerEntries } from "../schema/ledger.js";
import { routePrices, routes, smsTests } from "../schema/routes.js";
import { messages } from "../schema/tracking.js";
import type { Db } from "../types.js";
import { getRouteForWorker, type WorkerRoute } from "./routes.js";
import { customRouteFeeMicro } from "./sending.js";

/**
 * Routes > Testing (D4-06): Send Single and Test SMS rows, the list the page shows, the
 * worker's claim / record / finish cycle and the cost report.
 */

export type SmsTestRow = typeof smsTests.$inferSelect;

export async function createSmsTest(
  db: Db,
  organisationId: string,
  input: SmsTestInput,
  createdBy: string | null,
): Promise<SmsTestRow> {
  const scheduled = input.schedule !== null;
  const [row] = await db
    .insert(smsTests)
    .values({
      organisationId,
      type: input.type,
      country: input.country,
      routeIds: input.routeIds,
      senderModes: input.senderModes,
      customSender: input.customSender || null,
      textPresets: input.textPresets,
      customText: input.customText || null,
      recipient: input.recipient ? `+${input.recipient}` : null,
      testNetworks: input.testNetworks,
      hypothesis: input.hypothesis || null,
      jitter: input.jitter,
      cascade: input.cascade,
      scheduleDays: input.schedule?.days ?? null,
      scheduleTimes: input.schedule?.times ?? null,
      queueStatus: scheduled ? "scheduled" : "queued",
      createdBy,
    })
    .returning();
  if (!row) throw new Error("createSmsTest: no row returned");
  return row;
}

export interface SmsTestListRow {
  id: string;
  type: string;
  country: string;
  routeNames: string[];
  senderModes: string[];
  customSender: string | null;
  textPresets: string[];
  recipient: string | null;
  testNetworks: string[];
  hypothesis: string | null;
  scheduled: boolean;
  testsRan: number;
  successCount: number;
  costMicro: bigint;
  queueStatus: string;
  createdAt: Date;
  lastSentAt: Date | null;
  removedAt: Date | null;
}

export async function listSmsTests(
  db: Db,
  organisationId: string,
  input: {
    country?: string | undefined;
    showRemoved?: boolean;
    singlesOnly?: boolean;
    page: number;
    pageSize: number;
  },
): Promise<{ rows: SmsTestListRow[]; total: number }> {
  const conditions = [eq(smsTests.organisationId, organisationId)];
  if (!input.showRemoved) conditions.push(isNull(smsTests.removedAt));
  if (input.country) conditions.push(eq(smsTests.country, input.country.toUpperCase()));
  if (input.singlesOnly) conditions.push(eq(smsTests.type, "single"));
  const where = and(...conditions);
  const pageSize = Math.max(1, input.pageSize);
  const offset = Math.max(0, input.page - 1) * pageSize;
  const [rows, [count]] = await Promise.all([
    db
      .select()
      .from(smsTests)
      .where(where)
      .orderBy(desc(smsTests.createdAt))
      .limit(pageSize)
      .offset(offset),
    db.select({ total: sql<number>`count(*)::int` }).from(smsTests).where(where),
  ]);
  const routeIds = [...new Set(rows.flatMap((r) => r.routeIds))];
  const names =
    routeIds.length === 0
      ? []
      : await db
          .select({ id: routes.id, name: routes.name })
          .from(routes)
          .where(
            sql`${routes.id} in (${sql.join(
              routeIds.map((id) => sql`${id}`),
              sql`, `,
            )})`,
          );
  const nameOf = new Map(names.map((n) => [n.id, n.name]));
  return {
    rows: rows.map((r) => ({
      id: r.id,
      type: r.type,
      country: r.country,
      routeNames: r.routeIds.map((id) => nameOf.get(id) ?? "deleted route"),
      senderModes: r.senderModes,
      customSender: r.customSender,
      textPresets: r.textPresets,
      recipient: r.recipient,
      testNetworks: r.testNetworks,
      hypothesis: r.hypothesis,
      scheduled: r.scheduleDays !== null,
      testsRan: r.testsRan,
      successCount: r.successCount,
      costMicro: r.costMicro,
      queueStatus: r.queueStatus,
      createdAt: r.createdAt,
      lastSentAt: r.lastSentAt,
      removedAt: r.removedAt,
    })),
    total: count?.total ?? 0,
  };
}

/** "show removed" keeps the row; a removed scheduled test stops firing. */
export async function removeSmsTest(db: Db, organisationId: string, id: string): Promise<boolean> {
  const [row] = await db
    .update(smsTests)
    .set({ removedAt: new Date(), queueStatus: "done" })
    .where(
      and(
        eq(smsTests.id, id),
        eq(smsTests.organisationId, organisationId),
        isNull(smsTests.removedAt),
      ),
    )
    .returning({ id: smsTests.id });
  return row !== undefined;
}

export interface TestCostMonth {
  month: string;
  tests: number;
  messages: number;
  costMicro: bigint;
}

/** The Cost Report: tests created, messages sent and spend per month. */
export async function testCostReport(db: Db, organisationId: string): Promise<TestCostMonth[]> {
  const rows = await db
    .select({
      month: sql<string>`to_char(${smsTests.createdAt} at time zone 'UTC', 'YYYY-MM')`,
      tests: sql<number>`count(*)::int`,
      messages: sql<number>`coalesce(sum(${smsTests.testsRan}), 0)::int`,
      cost: sql<string>`coalesce(sum(${smsTests.costMicro}), 0)::text`,
    })
    .from(smsTests)
    .where(eq(smsTests.organisationId, organisationId))
    .groupBy(sql`1`)
    .orderBy(sql`1 desc`);
  return rows.map((r) => ({
    month: r.month,
    tests: Number(r.tests),
    messages: Number(r.messages),
    costMicro: BigInt(r.cost),
  }));
}

// ---------------------------------------------------------------------------
// Worker side
// ---------------------------------------------------------------------------

/** Tests waiting to run now: `queued` without a schedule. */
export async function listQueuedTests(
  db: Db,
): Promise<Array<{ id: string; organisationId: string }>> {
  return db
    .select({ id: smsTests.id, organisationId: smsTests.organisationId })
    .from(smsTests)
    .where(
      and(
        eq(smsTests.queueStatus, "queued"),
        isNull(smsTests.removedAt),
        isNull(smsTests.scheduleDays),
      ),
    )
    .orderBy(smsTests.createdAt)
    .limit(100);
}

/** Scheduled tests still alive, with what the dispatcher needs to decide whether they fire. */
export async function listScheduledTests(db: Db): Promise<
  Array<{
    id: string;
    organisationId: string;
    days: number[];
    times: string[];
    lastSlot: string | null;
  }>
> {
  const rows = await db
    .select({
      id: smsTests.id,
      organisationId: smsTests.organisationId,
      days: smsTests.scheduleDays,
      times: smsTests.scheduleTimes,
      lastSlot: smsTests.lastSlot,
    })
    .from(smsTests)
    .where(and(isNull(smsTests.removedAt), sql`${smsTests.scheduleDays} is not null`));
  return rows.map((r) => ({ ...r, days: r.days ?? [], times: r.times ?? [] }));
}

/** Claim a test for a run: queued (or scheduled, for `slotKey`) → running. False when someone else did. */
export async function claimTest(db: Db, id: string, slotKey: string | null): Promise<boolean> {
  const [row] = await db
    .update(smsTests)
    .set({ queueStatus: "running", ...(slotKey ? { lastSlot: slotKey } : {}) })
    .where(
      and(
        eq(smsTests.id, id),
        isNull(smsTests.removedAt),
        slotKey
          ? sql`${smsTests.queueStatus} in ('scheduled', 'done', 'failed') and ${smsTests.lastSlot} is distinct from ${slotKey}`
          : eq(smsTests.queueStatus, "queued"),
      ),
    )
    .returning({ id: smsTests.id });
  return row !== undefined;
}

export interface TestContext {
  test: SmsTestRow;
  routes: Array<WorkerRoute & { priceMicro: bigint | null }>;
  feeMicro: bigint;
  /** Texts of the organisation's recent sends, for "Random from History". */
  history: string[];
}

export async function loadTestContext(db: Db, testId: string): Promise<TestContext | null> {
  const [test] = await db.select().from(smsTests).where(eq(smsTests.id, testId)).limit(1);
  if (!test) return null;
  const routeRows = await Promise.all(test.routeIds.map((id) => getRouteForWorker(db, id)));
  const priced = await Promise.all(
    routeRows
      .filter((r): r is WorkerRoute => r !== null)
      .map(async (r) => {
        const [price] = await db
          .select({ priceMicro: routePrices.priceMicro })
          .from(routePrices)
          .where(
            and(
              eq(routePrices.routeId, r.id),
              eq(routePrices.country, test.country),
              sql`${routePrices.validFrom} <= now()`,
            ),
          )
          .orderBy(desc(routePrices.validFrom))
          .limit(1);
        return { ...r, priceMicro: price?.priceMicro ?? null };
      }),
  );
  const feeMicro = await customRouteFeeMicro(db, test.organisationId);
  const history = await db
    .select({ text: messages.text })
    .from(messages)
    .where(
      and(
        eq(messages.organisationId, test.organisationId),
        sql`${messages.campaignId} is not null`,
      ),
    )
    .orderBy(desc(messages.createdAt))
    .limit(20);
  return { test, routes: priced, feeMicro, history: history.map((h) => h.text) };
}

export interface TestMessageInput {
  testId: string;
  organisationId: string;
  routeId: string;
  /** Null when the route is a platform route. */
  routeOrganisationId: string | null;
  e164: string;
  senderId: string;
  text: string;
  encoding: string;
  parts: number;
  status: "sent" | "failed";
  providerMessageId: string | null;
  errorCode: string | null;
  priceMicro: bigint;
  feeMicro: bigint;
}

/**
 * Record one test message with its debit (and custom-route fee) when the carrier accepted
 * it, and bump the test's counters. One transaction; the message id is returned.
 */
export async function recordTestMessage(db: Db, input: TestMessageInput): Promise<string> {
  return db.transaction(async (tx) => {
    const accepted = input.status === "sent";
    const [message] = await tx
      .insert(messages)
      .values({
        organisationId: input.organisationId,
        campaignId: null,
        lapId: null,
        testId: input.testId,
        contactId: null,
        e164: input.e164,
        senderId: input.senderId,
        text: input.text,
        encoding: input.encoding,
        parts: input.parts,
        routeId: input.routeId,
        status: input.status,
        providerMessageId: input.providerMessageId,
        errorCode: input.errorCode,
        idempotencyKey: `test:${input.testId}:${input.routeId}:${input.senderId}:${Date.now()}:${Math.random()}`,
        sentAt: accepted ? new Date() : null,
      })
      .returning({ id: messages.id });
    if (!message) throw new Error("recordTestMessage: no row returned");
    let cost = 0n;
    if (accepted) {
      cost = BigInt(input.parts) * input.priceMicro;
      await tx.insert(ledgerEntries).values({
        organisationId: input.organisationId,
        kind: "debit",
        amountMicro: -cost,
        referenceType: "message",
        referenceId: message.id,
        idempotencyKey: `msg:${message.id}`,
        note: `test ${input.testId}`,
      });
      if (input.routeOrganisationId !== null && input.feeMicro > 0n) {
        const fee = BigInt(input.parts) * input.feeMicro;
        cost += fee;
        await tx.insert(ledgerEntries).values({
          organisationId: input.organisationId,
          kind: "fee",
          amountMicro: -fee,
          referenceType: "message",
          referenceId: message.id,
          idempotencyKey: `fee:${message.id}`,
          note: `custom route fee, test ${input.testId}`,
        });
      }
    }
    await tx
      .update(smsTests)
      .set({
        testsRan: sql`${smsTests.testsRan} + 1`,
        successCount: sql`${smsTests.successCount} + ${accepted ? 1 : 0}`,
        costMicro: sql`${smsTests.costMicro} + ${cost}`,
        lastSentAt: new Date(),
      })
      .where(eq(smsTests.id, input.testId));
    return message.id;
  });
}

/** Back to `scheduled` for a recurring test, else `done` or `failed`. */
export async function finishTest(db: Db, id: string, outcome: "done" | "failed"): Promise<void> {
  await db
    .update(smsTests)
    .set({
      queueStatus: sql`case when ${smsTests.scheduleDays} is not null then 'scheduled' else ${outcome} end`,
    })
    .where(eq(smsTests.id, id));
}
