import { count, desc, eq, isNotNull, isNull } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dashboardKpis } from "../queries/dashboard.js";
import { getBalanceMicro } from "../queries/ledger.js";
import { listProviders } from "../queries/lists.js";
import {
  campaigns,
  clicks,
  laps,
  ledgerEntries,
  lists,
  messages,
  postbacks,
} from "../schema/index.js";
import { createTestDb, type TestDb } from "../test/db.js";
import { ACTIVITY_LISTS, isLocalDatabaseUrl, seedDemoActivity } from "./demo-activity.js";
import { seedDemo } from "./demo-data.js";

const NOW = new Date("2026-11-16T12:00:00Z");

let t: TestDb;
let organisationId: string;

beforeAll(async () => {
  t = await createTestDb();
  const summary = await seedDemo(t.db);
  organisationId = summary.organisations.external ?? "";
}, 120_000);

afterAll(async () => {
  await t.close();
});

async function rows(table: PgTable): Promise<number> {
  const [row] = await t.db.select({ n: count() }).from(table);
  return row?.n ?? 0;
}

describe("isLocalDatabaseUrl", () => {
  it("accepts only a database on this machine", () => {
    expect(isLocalDatabaseUrl("postgresql://sendex:sendex@127.0.0.1:5432/sendex")).toBe(true);
    expect(isLocalDatabaseUrl("postgres://u:p@localhost/sendex")).toBe(true);
    expect(isLocalDatabaseUrl("postgresql://u:p@db.example.supabase.co:5432/postgres")).toBe(false);
    expect(isLocalDatabaseUrl(undefined)).toBe(false);
    expect(isLocalDatabaseUrl("not a url")).toBe(false);
  });
});

describe("seedDemoActivity", () => {
  it("adds lists with providers, finished campaigns, messages and conversions", async () => {
    const summary = await seedDemoActivity(t.db, NOW);
    expect(summary.lists).toBe(ACTIVITY_LISTS.length);
    expect(summary.campaigns).toBeGreaterThan(10);
    expect(summary.messages).toBeGreaterThan(2_000);
    expect(summary.leads).toBeGreaterThan(50);
    expect(summary.sales).toBeGreaterThan(10);

    expect(await rows(messages)).toBe(summary.messages);
    expect(await rows(campaigns)).toBe(summary.campaigns);
    expect(await rows(clicks)).toBeGreaterThan(0);
    expect(await listProviders(t.db, organisationId)).toEqual(["DER", "DIM", "RIS", "ZEN"]);

    // Some lists are left untouched on purpose, for "never sent" in List Follow-Up.
    const untouched = await t.db
      .select({ name: lists.name })
      .from(lists)
      .where(isNull(lists.lastSentAt));
    expect(untouched.map((l) => l.name)).toEqual(
      expect.arrayContaining(ACTIVITY_LISTS.filter((l) => !l.used).map((l) => l.name)),
    );
  }, 120_000);

  it("gives the dashboard sales, revenue and spend, all in the past", async () => {
    const kpis = await dashboardKpis(t.db, organisationId, {});
    expect(kpis.sales).toBeGreaterThan(10);
    expect(kpis.sent).toBeGreaterThan(2_000);
    const [latest] = await t.db
      .select({ at: messages.sentAt })
      .from(messages)
      .where(isNotNull(messages.sentAt))
      .orderBy(desc(messages.sentAt))
      .limit(1);
    expect(latest?.at?.getTime()).toBeLessThan(NOW.getTime());
    const future = await t.db.select({ at: postbacks.receivedAt }).from(postbacks);
    expect(future.every((p) => p.at.getTime() <= NOW.getTime())).toBe(true);
  });

  it("keeps lap counters in step with the rows and the balance positive", async () => {
    const lapRows = await t.db.select().from(laps);
    const sentTotal = lapRows.reduce((sum, l) => sum + l.sent, 0);
    const [submitted] = await t.db
      .select({ n: count() })
      .from(messages)
      .where(eq(messages.organisationId, organisationId));
    expect(sentTotal).toBeLessThanOrEqual(submitted?.n ?? 0);
    expect(lapRows.every((l) => l.status === "done")).toBe(true);
    expect(await getBalanceMicro(t.db, organisationId)).toBeGreaterThan(0n);
  });

  it("changes nothing when it is run again", async () => {
    const before = {
      messages: await rows(messages),
      postbacks: await rows(postbacks),
      ledger: await rows(ledgerEntries),
      lists: await rows(lists),
    };
    await seedDemoActivity(t.db, new Date("2026-12-01T12:00:00Z"));
    expect({
      messages: await rows(messages),
      postbacks: await rows(postbacks),
      ledger: await rows(ledgerEntries),
      lists: await rows(lists),
    }).toEqual(before);
  }, 120_000);
});
