import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, expectUniqueViolation, seedOrganisation, type TestDb } from "../test/db.js";
import { contacts, listMembers, lists, suppressions } from "./lists.js";

let t: TestDb;
let orgA: string;
let orgB: string;

beforeAll(async () => {
  t = await createTestDb();
  orgA = await seedOrganisation(t.db, "org-a");
  orgB = await seedOrganisation(t.db, "org-b");
});

afterAll(async () => {
  await t.close();
});

describe("contacts", () => {
  it("rejects the same e164 twice in one organisation", async () => {
    await t.db
      .insert(contacts)
      .values({ organisationId: orgA, e164: "+34600000001", country: "ES" });
    await expectUniqueViolation(
      t.db.insert(contacts).values({ organisationId: orgA, e164: "+34600000001", country: "ES" }),
    );
  });

  it("allows the same e164 in two organisations", async () => {
    await t.db
      .insert(contacts)
      .values({ organisationId: orgA, e164: "+34600000002", country: "ES" });
    await t.db
      .insert(contacts)
      .values({ organisationId: orgB, e164: "+34600000002", country: "ES" });
    const rows = await t.db.query.contacts.findMany({
      where: (c, { eq }) => eq(c.e164, "+34600000002"),
    });
    expect(rows).toHaveLength(2);
  });
});

describe("list_members", () => {
  it("rejects the same contact twice in one list", async () => {
    const [contact] = await t.db
      .insert(contacts)
      .values({ organisationId: orgA, e164: "+34600000003", country: "ES" })
      .returning({ id: contacts.id });
    const [list] = await t.db
      .insert(lists)
      .values({ organisationId: orgA, name: "Test_ES", country: "ES" })
      .returning({ id: lists.id });
    if (!contact || !list) throw new Error("setup failed");

    await t.db
      .insert(listMembers)
      .values({ organisationId: orgA, listId: list.id, contactId: contact.id });
    await expectUniqueViolation(
      t.db
        .insert(listMembers)
        .values({ organisationId: orgA, listId: list.id, contactId: contact.id }),
    );
  });

  it("defaults bad to false and sent_at / flushed_at to null", async () => {
    const [contact] = await t.db
      .insert(contacts)
      .values({ organisationId: orgA, e164: "+34600000004", country: "ES" })
      .returning({ id: contacts.id });
    const [list] = await t.db
      .insert(lists)
      .values({ organisationId: orgA, name: "Test_ES_2", country: "ES" })
      .returning({ id: lists.id, numbersCount: lists.numbersCount });
    if (!contact || !list) throw new Error("setup failed");
    expect(list.numbersCount).toBe(0);

    const [member] = await t.db
      .insert(listMembers)
      .values({ organisationId: orgA, listId: list.id, contactId: contact.id })
      .returning();
    expect(member?.bad).toBe(false);
    expect(member?.sentAt).toBeNull();
    expect(member?.flushedAt).toBeNull();
  });
});

describe("suppressions", () => {
  it("rejects the same e164 twice in one organisation", async () => {
    await t.db
      .insert(suppressions)
      .values({ organisationId: orgA, e164: "+34600000009", reason: "unsubscribe", source: "sms" });
    await expectUniqueViolation(
      t.db
        .insert(suppressions)
        .values({ organisationId: orgA, e164: "+34600000009", reason: "complaint", source: "ui" }),
    );
  });
});
