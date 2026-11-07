import { count, eq, isNull } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getBalanceMicro } from "../queries/ledger.js";
import {
  contacts,
  ledgerEntries,
  links,
  listMembers,
  lists,
  lookupPrices,
  organisations,
  routePrices,
  routes,
  senderIds,
  sidGroups,
} from "../schema/index.js";
import { createTestDb, type TestDb } from "../test/db.js";
import { demoNumber, eurToMicro, seedDemo, seedUuid } from "./demo-data.js";

describe("seed helpers", () => {
  it("seedUuid is a stable RFC 4122 v5-shaped uuid", () => {
    const a = seedUuid("contact:+34612345678");
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(seedUuid("contact:+34612345678")).toBe(a);
    expect(seedUuid("contact:+34612345679")).not.toBe(a);
  });

  it("demoNumber counts up from a fixed start", () => {
    const es = { prefix: "+346", digits: 8, start: 12_345_678 };
    expect(demoNumber(es, 0)).toBe("+34612345678");
    expect(demoNumber(es, 1)).toBe("+34612345679");
    expect(demoNumber({ prefix: "+485", digits: 8, start: 1_234_567 }, 0)).toBe("+48501234567");
  });

  it("eurToMicro converts prices without float drift", () => {
    expect(eurToMicro(0.0357)).toBe(35_700n);
    expect(eurToMicro(0.022)).toBe(22_000n);
    expect(eurToMicro(4_988.31)).toBe(4_988_310_000n);
  });
});

let t: TestDb;

beforeAll(async () => {
  t = await createTestDb();
}, 60_000);

afterAll(async () => {
  await t.close();
});

async function rows(table: PgTable): Promise<number> {
  const [row] = await t.db.select({ n: count() }).from(table);
  return row?.n ?? 0;
}

async function snapshot() {
  return {
    organisations: await rows(organisations),
    lists: await rows(lists),
    contacts: await rows(contacts),
    listMembers: await rows(listMembers),
    sidGroups: await rows(sidGroups),
    senderIds: await rows(senderIds),
    links: await rows(links),
    routes: await rows(routes),
    routePrices: await rows(routePrices),
    lookupPrices: await rows(lookupPrices),
    ledgerEntries: await rows(ledgerEntries),
  };
}

describe("seedDemo", () => {
  it("creates the demo organisations and data", async () => {
    await seedDemo(t.db);
    const s = await snapshot();
    expect(s).toEqual({
      organisations: 2,
      lists: 6,
      contacts: 1_738 + 1_947 + 2_997 + 3_000 + 3_000 + 2_600,
      listMembers: 1_738 + 1_947 + 2_997 + 3_000 + 3_000 + 2_600,
      sidGroups: 6,
      senderIds: 67,
      links: 3,
      routes: 11,
      routePrices: 13,
      lookupPrices: 7,
      ledgerEntries: 1,
    });
  }, 120_000);

  it("is idempotent: a second run changes nothing", async () => {
    const before = await snapshot();
    await seedDemo(t.db);
    expect(await snapshot()).toEqual(before);
  }, 120_000);

  it("gives External a EUR 4,988.31 balance and its own SMPP route", async () => {
    const external = await t.db.query.organisations.findFirst({
      where: eq(organisations.slug, "external"),
    });
    if (!external) throw new Error("External organisation missing");
    expect(await getBalanceMicro(t.db, external.id)).toBe(4_988_310_000n);

    const custom = await t.db.query.routes.findFirst({ where: eq(routes.name, "23Telecom") });
    expect(custom?.provider).toBe("23telecom");
    expect(custom?.organisationId).toBe(external.id);
    const [prices] = await t.db
      .select({ n: count() })
      .from(routePrices)
      .where(eq(routePrices.routeId, custom?.id ?? ""));
    expect(prices?.n).toBe(0);

    const [platform] = await t.db
      .select({ n: count() })
      .from(routes)
      .where(isNull(routes.organisationId));
    expect(platform?.n).toBe(10);
  });

  it("builds deterministic E.164 numbers per country list", async () => {
    const uk = await t.db.query.lists.findFirst({
      where: eq(lists.name, "Roy Boy_UK_14092026_Batch2"),
    });
    expect(uk?.country).toBe("GB");
    expect(uk?.numbersCount).toBe(2_997);
    if (!uk) throw new Error("UK list missing");

    const members = await t.db
      .select({ e164: contacts.e164, country: contacts.country })
      .from(listMembers)
      .innerJoin(contacts, eq(contacts.id, listMembers.contactId))
      .where(eq(listMembers.listId, uk.id));
    expect(members).toHaveLength(2_997);
    expect(members.every((m) => /^\+447\d{9}$/.test(m.e164) && m.country === "GB")).toBe(true);
    expect(new Set(members.map((m) => m.e164)).size).toBe(2_997);
  });

  it("gives every country a sender id group with 8 to 17 sender ids", async () => {
    const groups = await t.db
      .select({ country: sidGroups.country, n: count(senderIds.id) })
      .from(sidGroups)
      .leftJoin(senderIds, eq(senderIds.sidGroupId, sidGroups.id))
      .groupBy(sidGroups.country);
    expect(groups.map((g) => g.country).sort()).toEqual(["DE", "ES", "FI", "FR", "GB", "PL"]);
    expect(groups.every((g) => g.n >= 8 && g.n <= 17)).toBe(true);
  });
});
