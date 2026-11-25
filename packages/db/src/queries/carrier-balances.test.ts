import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ledgerEntries } from "../schema/ledger.js";
import { routes } from "../schema/routes.js";
import { createTestDb, seedOrganisation, type TestDb } from "../test/db.js";
import {
  getSpendableBalanceMicro,
  organisationBalance,
  saveCarrierBalance,
} from "./carrier-balances.js";

let t: TestDb;
let onCarrier: string;
let twoCarriers: string;
let ledgerOnly: string;

const CHECKED = new Date("2026-11-25T14:00:00Z");

beforeAll(async () => {
  t = await createTestDb();
  onCarrier = await seedOrganisation(t.db, "bal-carrier");
  twoCarriers = await seedOrganisation(t.db, "bal-two");
  ledgerOnly = await seedOrganisation(t.db, "bal-ledger");
  await t.db.insert(routes).values([
    { organisationId: onCarrier, provider: "23telecom", name: "23Telecom", country: null },
    { organisationId: twoCarriers, provider: "23telecom", name: "23Telecom", country: null },
    { organisationId: twoCarriers, provider: "other", name: "Other", country: null },
    {
      organisationId: twoCarriers,
      provider: "switched-off",
      name: "Off",
      country: null,
      active: false,
    },
    // A platform route of a carrier without a balance: it does not count.
    { organisationId: null, provider: "fake", name: "405", country: "ES" },
  ]);
  await t.db.insert(ledgerEntries).values([
    {
      organisationId: onCarrier,
      kind: "deposit",
      amountMicro: 51_856_000n,
      referenceType: "manual",
      idempotencyKey: "bal:carrier",
    },
    {
      organisationId: ledgerOnly,
      kind: "deposit",
      amountMicro: 20_000_000n,
      referenceType: "manual",
      idempotencyKey: "bal:ledger",
    },
  ]);
});

afterAll(async () => {
  await t.close();
});

describe("carrier balances (D5-17)", () => {
  it("uses Sendex's own ledger until a carrier balance has been read", async () => {
    expect(await organisationBalance(t.db, onCarrier)).toEqual({
      source: "ledger",
      totalMicro: 51_856_000n,
      carriers: [],
    });
  });

  it("gives an organisation the balance of the carrier behind its route, not its ledger", async () => {
    await saveCarrierBalance(t.db, {
      provider: "23telecom",
      balanceMicro: 417_360_500n,
      currency: "EUR",
      reportedAt: new Date("2026-11-23T19:01:30Z"),
      checkedAt: CHECKED,
    });
    expect(await organisationBalance(t.db, onCarrier)).toEqual({
      source: "carrier",
      totalMicro: 417_360_500n,
      carriers: [
        {
          provider: "23telecom",
          routeName: "23Telecom",
          balanceMicro: 417_360_500n,
          currency: "EUR",
          reportedAt: new Date("2026-11-23T19:01:30Z"),
          checkedAt: CHECKED,
        },
      ],
    });
    expect(await getSpendableBalanceMicro(t.db, onCarrier)).toBe(417_360_500n);
  });

  it("adds up the carriers of active routes, each once", async () => {
    await saveCarrierBalance(t.db, {
      provider: "other",
      balanceMicro: 100_000_000n,
      currency: "EUR",
      reportedAt: null,
      checkedAt: CHECKED,
    });
    await saveCarrierBalance(t.db, {
      provider: "switched-off",
      balanceMicro: 999_000_000n,
      currency: "EUR",
      reportedAt: null,
      checkedAt: CHECKED,
    });
    const balance = await organisationBalance(t.db, twoCarriers);
    expect(balance.totalMicro).toBe(517_360_500n);
    expect(balance.carriers.map((c) => c.provider)).toEqual(["23telecom", "other"]);
  });

  it("keeps the ledger for an organisation whose carriers report no balance", async () => {
    expect(await getSpendableBalanceMicro(t.db, ledgerOnly)).toBe(20_000_000n);
  });

  it("replaces the stored balance on the next read", async () => {
    await saveCarrierBalance(t.db, {
      provider: "23telecom",
      balanceMicro: 400_000_000n,
      currency: "EUR",
      reportedAt: null,
      checkedAt: new Date("2026-11-25T14:01:00Z"),
    });
    expect(await getSpendableBalanceMicro(t.db, onCarrier)).toBe(400_000_000n);
  });
});
