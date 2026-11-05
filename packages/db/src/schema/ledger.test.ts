import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { balanceSql, getBalanceMicro } from "../queries/ledger.js";
import { createTestDb, expectUniqueViolation, seedOrganisation, type TestDb } from "../test/db.js";
import { organisations } from "./core.js";
import { ledgerEntries } from "./ledger.js";

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

describe("ledger_entries", () => {
  it("rejects a second entry with the same idempotency key", async () => {
    await t.db.insert(ledgerEntries).values({
      organisationId: orgA,
      kind: "deposit",
      amountMicro: 1_000_000n,
      idempotencyKey: "deposit:1",
    });
    await expectUniqueViolation(
      t.db.insert(ledgerEntries).values({
        organisationId: orgA,
        kind: "deposit",
        amountMicro: 1_000_000n,
        idempotencyKey: "deposit:1",
      }),
    );
  });
});

describe("balance", () => {
  it("is zero for an organisation with no entries", async () => {
    expect(await getBalanceMicro(t.db, orgB)).toBe(0n);
  });

  it("sums deposits minus debits, per organisation", async () => {
    await t.db.insert(ledgerEntries).values([
      {
        organisationId: orgA,
        kind: "deposit",
        amountMicro: 4_988_310_000n,
        idempotencyKey: "deposit:2",
      },
      {
        organisationId: orgA,
        kind: "debit",
        amountMicro: -35_700n,
        referenceType: "message",
        referenceId: "m1",
        idempotencyKey: "debit:m1",
      },
      {
        organisationId: orgA,
        kind: "debit",
        amountMicro: -35_700n,
        referenceType: "message",
        referenceId: "m2",
        idempotencyKey: "debit:m2",
      },
      {
        organisationId: orgA,
        kind: "refund",
        amountMicro: 35_700n,
        referenceType: "message",
        referenceId: "m2",
        idempotencyKey: "refund:m2",
      },
      {
        organisationId: orgB,
        kind: "deposit",
        amountMicro: 10_000_000n,
        idempotencyKey: "deposit:b",
      },
    ]);
    // 1_000_000 (first test) + 4_988_310_000 - 35_700 - 35_700 + 35_700
    expect(await getBalanceMicro(t.db, orgA)).toBe(4_989_274_300n);
    expect(await getBalanceMicro(t.db, orgB)).toBe(10_000_000n);
  });

  it("balanceSql can be embedded in another query", async () => {
    const [row] = await t.db
      .select({ id: organisations.id, balance: balanceSql(orgB) })
      .from(organisations)
      .where(eq(organisations.id, orgB));
    expect(row?.balance).toBe(10_000_000n);
  });
});
