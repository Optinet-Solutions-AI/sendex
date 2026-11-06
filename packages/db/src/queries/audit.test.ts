import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { users } from "../schema/core.js";
import { createTestDb, seedOrganisation, type TestDb } from "../test/db.js";
import { listAuditActions, listAuditActors, listAuditEntries, recordAudit } from "./audit.js";

let t: TestDb;
let orgA: string;
let orgB: string;
let alice: string;
let bob: string;

beforeAll(async () => {
  t = await createTestDb();
  orgA = await seedOrganisation(t.db, "org-a");
  orgB = await seedOrganisation(t.db, "org-b");
  const inserted = await t.db
    .insert(users)
    .values([
      { clerkUserId: "u_alice", email: "alice@example.com", name: "Alice" },
      { clerkUserId: "u_bob", email: "bob@example.com", name: null },
    ])
    .returning({ id: users.id, email: users.email });
  const a = inserted.find((u) => u.email === "alice@example.com");
  const b = inserted.find((u) => u.email === "bob@example.com");
  if (!a || !b) throw new Error("user seed failed");
  alice = a.id;
  bob = b.id;

  await recordAudit(t.db, orgA, {
    actorUserId: alice,
    action: "list.upload",
    targetType: "list",
    targetId: "l1",
    details: { name: "ES", imported: 10 },
  });
  await recordAudit(t.db, orgA, {
    actorUserId: bob,
    action: "balance.deposit",
    targetType: "ledger_entry",
    targetId: "e1",
    details: { amountMicro: "25000000", method: "manual" },
  });
  await recordAudit(t.db, orgA, {
    actorUserId: null,
    action: "campaign.send",
    targetType: "campaign",
    targetId: "c1",
  });
  await recordAudit(t.db, orgB, { actorUserId: alice, action: "list.flush" });
});

afterAll(async () => {
  await t.close();
});

describe("listAuditEntries", () => {
  it("lists the organisation's entries newest first with the actor joined", async () => {
    const result = await listAuditEntries(t.db, orgA, { page: 1, pageSize: 10 });
    expect(result.total).toBe(3);
    expect(result.rows.map((r) => r.action)).toEqual([
      "campaign.send",
      "balance.deposit",
      "list.upload",
    ]);
    const deposit = result.rows[1];
    expect(deposit?.actorUserId).toBe(bob);
    expect(deposit?.actorEmail).toBe("bob@example.com");
    expect(deposit?.actorName).toBeNull();
    expect(result.rows[0]?.actorEmail).toBeNull();
    expect(result.rows[2]?.actorName).toBe("Alice");
    expect(result.rows[2]?.details).toEqual({ name: "ES", imported: 10 });
  });

  it("filters by action, actor and date, and pages", async () => {
    const byAction = await listAuditEntries(t.db, orgA, {
      action: "balance.deposit",
      page: 1,
      pageSize: 10,
    });
    expect(byAction.rows.map((r) => r.action)).toEqual(["balance.deposit"]);

    const byActor = await listAuditEntries(t.db, orgA, {
      actorUserId: alice,
      page: 1,
      pageSize: 10,
    });
    expect(byActor.rows.map((r) => r.action)).toEqual(["list.upload"]);

    const future = await listAuditEntries(t.db, orgA, {
      from: new Date(Date.now() + 60_000),
      page: 1,
      pageSize: 10,
    });
    expect(future.total).toBe(0);

    const paged = await listAuditEntries(t.db, orgA, { page: 2, pageSize: 2 });
    expect(paged.total).toBe(3);
    expect(paged.rows).toHaveLength(1);
  });

  it("never shows another organisation's rows", async () => {
    const other = await listAuditEntries(t.db, orgB, { page: 1, pageSize: 10 });
    expect(other.rows.map((r) => r.action)).toEqual(["list.flush"]);
  });
});

describe("audit filter options", () => {
  it("lists the distinct actions and actors of the organisation", async () => {
    expect(await listAuditActions(t.db, orgA)).toEqual([
      "balance.deposit",
      "campaign.send",
      "list.upload",
    ]);
    const actors = await listAuditActors(t.db, orgA);
    expect(actors).toEqual([
      { id: alice, name: "Alice", email: "alice@example.com" },
      { id: bob, name: null, email: "bob@example.com" },
    ]);
  });
});
