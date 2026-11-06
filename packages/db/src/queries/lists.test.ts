import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { contacts, listMembers, lists, suppressions } from "../schema/index.js";
import { createTestDb, seedOrganisation, type TestDb } from "../test/db.js";
import {
  createList,
  deleteList,
  flushAllLists,
  flushList,
  getList,
  importContacts,
  listAvailableCount,
  listListNames,
  listLists,
  listMembersPage,
} from "./lists.js";

let t: TestDb;
let orgA: string;
let orgB: string;

const es = (n: number) => ({ e164: `+346001${String(n).padStart(5, "0")}`, country: "ES" });

beforeAll(async () => {
  t = await createTestDb();
  orgA = await seedOrganisation(t.db, "org-a");
  orgB = await seedOrganisation(t.db, "org-b");
});

afterAll(async () => {
  await t.close();
});

describe("importContacts", () => {
  it("creates a new list, upserts contacts and inserts members", async () => {
    const result = await importContacts(t.db, orgA, {
      newList: { name: "Import_ES", country: "ES" },
      rows: [
        { ...es(1), firstName: "Ana", custom1: "VIP" },
        { ...es(2), email: "b@example.com" },
        es(3),
      ],
      duplicates: "skip_existing",
      flushAfterImport: false,
    });
    expect(result.imported).toBe(3);
    expect(result.skippedExisting).toBe(0);

    const list = await getList(t.db, orgA, result.listId);
    expect(list?.name).toBe("Import_ES");
    expect(list?.numbersCount).toBe(3);
    expect(list?.lastUploadAt).toBeInstanceOf(Date);
    expect(list?.counts).toEqual({ members: 3, available: 3, sent: 0, bad: 0 });

    const contact = await t.db.query.contacts.findFirst({
      where: (c, { and, eq }) => and(eq(c.organisationId, orgA), eq(c.e164, es(1).e164)),
    });
    expect(contact?.firstName).toBe("Ana");
    expect(contact?.custom1).toBe("VIP");
  });

  it("skips contacts the organisation already has with skip_existing", async () => {
    const result = await importContacts(t.db, orgA, {
      newList: { name: "Import_ES_2", country: "ES" },
      rows: [es(1), es(4)],
      duplicates: "skip_existing",
      flushAfterImport: false,
    });
    expect(result.imported).toBe(1);
    expect(result.skippedExisting).toBe(1);
    const list = await getList(t.db, orgA, result.listId);
    expect(list?.numbersCount).toBe(1);
  });

  it("adds existing contacts to the list with allow, and never the same member twice", async () => {
    const created = await importContacts(t.db, orgA, {
      newList: { name: "Import_ES_3", country: "ES" },
      rows: [es(1), es(5)],
      duplicates: "allow",
      flushAfterImport: false,
    });
    expect(created.imported).toBe(2);
    expect(created.skippedExisting).toBe(0);

    const again = await importContacts(t.db, orgA, {
      listId: created.listId,
      rows: [es(1), es(5), es(6)],
      duplicates: "allow",
      flushAfterImport: false,
    });
    expect(again.imported).toBe(1);
    expect(again.skippedExisting).toBe(2);
    const list = await getList(t.db, orgA, created.listId);
    expect(list?.numbersCount).toBe(3);
  });

  it("does not let one organisation import into another's list", async () => {
    const created = await createList(t.db, orgB, { name: "B_ES", country: "ES" });
    await expect(
      importContacts(t.db, orgA, {
        listId: created.id,
        rows: [es(7)],
        duplicates: "allow",
        flushAfterImport: false,
      }),
    ).rejects.toThrow(/list not found/i);
    expect(await getList(t.db, orgA, created.id)).toBeNull();
  });

  it("updates the contact fields of an existing contact without losing them when blank", async () => {
    await importContacts(t.db, orgA, {
      newList: { name: "Import_ES_4", country: "ES" },
      rows: [{ ...es(8), firstName: "Eva", lastName: "Ruiz" }],
      duplicates: "allow",
      flushAfterImport: false,
    });
    await importContacts(t.db, orgA, {
      newList: { name: "Import_ES_5", country: "ES" },
      rows: [{ ...es(8), firstName: "Evita" }],
      duplicates: "allow",
      flushAfterImport: false,
    });
    const contact = await t.db.query.contacts.findFirst({
      where: (c, { and, eq }) => and(eq(c.organisationId, orgA), eq(c.e164, es(8).e164)),
    });
    expect(contact?.firstName).toBe("Evita");
    expect(contact?.lastName).toBe("Ruiz");
  });

  it("inserts more than one chunk of members", async () => {
    const rows = Array.from({ length: 2_350 }, (_, i) => es(10_000 + i));
    const result = await importContacts(t.db, orgA, {
      newList: { name: "Big_ES", country: "ES" },
      rows,
      duplicates: "allow",
      flushAfterImport: false,
    });
    expect(result.imported).toBe(2_350);
    const list = await getList(t.db, orgA, result.listId);
    expect(list?.numbersCount).toBe(2_350);
  });
});

describe("flush and availability", () => {
  let listId: string;

  beforeAll(async () => {
    const result = await importContacts(t.db, orgA, {
      newList: { name: "Flush_ES", country: "ES" },
      rows: [es(21), es(22), es(23), es(24)],
      duplicates: "allow",
      flushAfterImport: false,
    });
    listId = result.listId;
    const members = await t.db.select().from(listMembers).where(eq(listMembers.listId, listId));
    const [m1, m2, m3] = members;
    if (!m1 || !m2 || !m3) throw new Error("setup failed");
    await t.db.update(listMembers).set({ sentAt: new Date() }).where(eq(listMembers.id, m1.id));
    await t.db.update(listMembers).set({ sentAt: new Date() }).where(eq(listMembers.id, m2.id));
    await t.db
      .update(listMembers)
      .set({ bad: true, badReason: "carrier" })
      .where(eq(listMembers.id, m3.id));
    await t.db.update(lists).set({ lastSentAt: new Date() }).where(eq(lists.id, listId));
  });

  it("counts available as not bad, not sent, not suppressed", async () => {
    expect(await listAvailableCount(t.db, orgA, listId)).toBe(1);
    await t.db
      .insert(suppressions)
      .values({ organisationId: orgA, e164: es(24).e164, reason: "unsubscribe", source: "sms" });
    expect(await listAvailableCount(t.db, orgA, listId)).toBe(0);
    // Another organisation's suppression does not count.
    await t.db
      .insert(suppressions)
      .values({ organisationId: orgB, e164: es(23).e164, reason: "unsubscribe", source: "sms" });
    const list = await getList(t.db, orgA, listId);
    expect(list?.counts).toEqual({ members: 4, available: 0, sent: 2, bad: 1 });
  });

  it("flushList resets sent_at, stamps flushed_at and keeps bad flags", async () => {
    const flushed = await flushList(t.db, orgA, listId);
    expect(flushed).toBe(4);
    const members = await t.db.select().from(listMembers).where(eq(listMembers.listId, listId));
    expect(members.every((m) => m.sentAt === null)).toBe(true);
    expect(members.every((m) => m.flushedAt instanceof Date)).toBe(true);
    expect(members.filter((m) => m.bad)).toHaveLength(1);
    const list = await getList(t.db, orgA, listId);
    expect(list?.counts).toEqual({ members: 4, available: 2, sent: 0, bad: 1 });
  });

  it("flushList is scoped to the organisation", async () => {
    expect(await flushList(t.db, orgB, listId)).toBe(0);
  });

  it("flushAfterImport flushes the whole list, not only the new rows", async () => {
    const members = await t.db.select().from(listMembers).where(eq(listMembers.listId, listId));
    const [m1] = members;
    if (!m1) throw new Error("setup failed");
    await t.db.update(listMembers).set({ sentAt: new Date() }).where(eq(listMembers.id, m1.id));
    await importContacts(t.db, orgA, {
      listId,
      rows: [es(25)],
      duplicates: "allow",
      flushAfterImport: true,
    });
    const list = await getList(t.db, orgA, listId);
    expect(list?.counts.sent).toBe(0);
    expect(list?.counts.members).toBe(5);
  });

  it("flushAllLists flushes every list of the organisation only", async () => {
    const a = await importContacts(t.db, orgA, {
      newList: { name: "FlushAll_A", country: "FR" },
      rows: [{ e164: "+33600000001", country: "FR" }],
      duplicates: "allow",
      flushAfterImport: false,
    });
    const b = await importContacts(t.db, orgB, {
      newList: { name: "FlushAll_B", country: "FR" },
      rows: [{ e164: "+33600000001", country: "FR" }],
      duplicates: "allow",
      flushAfterImport: false,
    });
    await t.db
      .update(listMembers)
      .set({ sentAt: new Date() })
      .where(eq(listMembers.listId, a.listId));
    await t.db
      .update(listMembers)
      .set({ sentAt: new Date() })
      .where(eq(listMembers.listId, b.listId));

    const result = await flushAllLists(t.db, orgA);
    expect(result.lists).toBeGreaterThanOrEqual(1);
    expect(result.members).toBeGreaterThanOrEqual(1);
    expect((await getList(t.db, orgA, a.listId))?.counts.sent).toBe(0);
    expect((await getList(t.db, orgB, b.listId))?.counts.sent).toBe(1);
  });
});

describe("listLists", () => {
  let orgC: string;

  beforeAll(async () => {
    orgC = await seedOrganisation(t.db, "org-c");
    const specs = [
      { name: "Roy Boy_ES_Batch1", country: "ES", n: 3, sent: 2 },
      { name: "Roy Boy_FR_Batch1", country: "FR", n: 5, sent: 0 },
      { name: "Promo_UK", country: "GB", n: 1, sent: 1 },
    ];
    let seq = 0;
    for (const spec of specs) {
      const rows = Array.from({ length: spec.n }, () => {
        seq += 1;
        return { e164: `+447700${String(seq).padStart(6, "0")}`, country: spec.country };
      });
      const created = await importContacts(t.db, orgC, {
        newList: { name: spec.name, country: spec.country },
        rows,
        duplicates: "allow",
        flushAfterImport: false,
      });
      const members = await t.db
        .select({ id: listMembers.id })
        .from(listMembers)
        .where(eq(listMembers.listId, created.listId));
      for (const m of members.slice(0, spec.sent)) {
        await t.db.update(listMembers).set({ sentAt: new Date() }).where(eq(listMembers.id, m.id));
      }
    }
  });

  it("returns every list of the organisation with its counts and a total", async () => {
    const page = await listLists(t.db, orgC, { pageSize: 50 });
    expect(page.total).toBe(3);
    expect(page.rows).toHaveLength(3);
    const es = page.rows.find((r) => r.name === "Roy Boy_ES_Batch1");
    expect(es).toMatchObject({ country: "ES", numbersCount: 3, sent: 2 });
    expect(es?.createdAt).toBeInstanceOf(Date);
    expect(es?.lastUploadAt).toBeInstanceOf(Date);
    expect(es?.lastSentAt).toBeNull();
  });

  it("searches by name (case-insensitive) and filters by country", async () => {
    const search = await listLists(t.db, orgC, { search: "roy boy", pageSize: 50 });
    expect(search.total).toBe(2);
    const fr = await listLists(t.db, orgC, { country: "FR", pageSize: 50 });
    expect(fr.rows.map((r) => r.name)).toEqual(["Roy Boy_FR_Batch1"]);
    const none = await listLists(t.db, orgC, { search: "roy boy", country: "GB", pageSize: 50 });
    expect(none.total).toBe(0);
  });

  it("sorts by any column in either direction", async () => {
    const byNumbers = await listLists(t.db, orgC, {
      sort: "numbersCount",
      dir: "desc",
      pageSize: 50,
    });
    expect(byNumbers.rows.map((r) => r.numbersCount)).toEqual([5, 3, 1]);
    const bySent = await listLists(t.db, orgC, { sort: "sent", dir: "asc", pageSize: 50 });
    expect(bySent.rows.map((r) => r.sent)).toEqual([0, 1, 2]);
    const byName = await listLists(t.db, orgC, { sort: "name", dir: "asc", pageSize: 50 });
    expect(byName.rows.map((r) => r.name)).toEqual([
      "Promo_UK",
      "Roy Boy_ES_Batch1",
      "Roy Boy_FR_Batch1",
    ]);
  });

  it("pages with the total unchanged", async () => {
    const p1 = await listLists(t.db, orgC, { sort: "name", dir: "asc", page: 1, pageSize: 2 });
    const p2 = await listLists(t.db, orgC, { sort: "name", dir: "asc", page: 2, pageSize: 2 });
    expect(p1.total).toBe(3);
    expect(p1.rows).toHaveLength(2);
    expect(p2.rows).toHaveLength(1);
    expect(p2.rows[0]?.name).toBe("Roy Boy_FR_Batch1");
  });

  it("lists names for a select, scoped to the organisation", async () => {
    const names = await listListNames(t.db, orgC);
    expect(names.map((n) => n.name).sort()).toEqual([
      "Promo_UK",
      "Roy Boy_ES_Batch1",
      "Roy Boy_FR_Batch1",
    ]);
    expect(names[0]).toHaveProperty("country");
  });

  it("pages the members of a list with their numbers", async () => {
    const [list] = (await listLists(t.db, orgC, { country: "FR", pageSize: 1 })).rows;
    if (!list) throw new Error("setup failed");
    const page = await listMembersPage(t.db, orgC, list.id, { page: 1, pageSize: 2 });
    expect(page.total).toBe(5);
    expect(page.rows).toHaveLength(2);
    expect(page.rows[0]?.e164).toMatch(/^\+447700/);
    expect(page.rows[0]).toMatchObject({ bad: false, sentAt: null });
    expect(await listMembersPage(t.db, orgA, list.id, { page: 1, pageSize: 2 })).toEqual({
      rows: [],
      total: 0,
    });
  });

  it("deletes a list and its members but not its contacts", async () => {
    const created = await importContacts(t.db, orgC, {
      newList: { name: "Temp", country: "ES" },
      rows: [{ e164: "+34600999999", country: "ES" }],
      duplicates: "allow",
      flushAfterImport: false,
    });
    expect(await deleteList(t.db, orgA, created.listId)).toBe(false);
    expect(await deleteList(t.db, orgC, created.listId)).toBe(true);
    expect(await getList(t.db, orgC, created.listId)).toBeNull();
    const remaining = await t.db.select().from(contacts).where(eq(contacts.e164, "+34600999999"));
    expect(remaining).toHaveLength(1);
  });
});
