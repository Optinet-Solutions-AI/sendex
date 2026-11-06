import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, seedOrganisation, type TestDb } from "../test/db.js";
import { getSettings, markLowBalanceAlerted, updateSettings } from "./settings.js";

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

describe("organisation settings", () => {
  it("returns defaults for an organisation that never saved settings", async () => {
    expect(await getSettings(t.db, orgA)).toEqual({
      organisationId: orgA,
      lowBalanceThresholdMicro: null,
      lowBalanceEmails: [],
      lowBalanceAlertedAt: null,
      dailyMessageCap: null,
      dailySpendCapMicro: null,
    });
  });

  it("creates the row on first update and updates it afterwards", async () => {
    const first = await updateSettings(t.db, orgA, {
      lowBalanceThresholdMicro: 100_000_000n,
      lowBalanceEmails: ["ops@example.com"],
      dailyMessageCap: 50_000,
      dailySpendCapMicro: null,
    });
    expect(first.lowBalanceThresholdMicro).toBe(100_000_000n);
    expect(first.lowBalanceEmails).toEqual(["ops@example.com"]);
    expect(first.dailyMessageCap).toBe(50_000);
    expect(first.dailySpendCapMicro).toBeNull();

    const second = await updateSettings(t.db, orgA, {
      lowBalanceThresholdMicro: null,
      lowBalanceEmails: [],
      dailyMessageCap: null,
      dailySpendCapMicro: 250_000_000n,
    });
    expect(second.lowBalanceThresholdMicro).toBeNull();
    expect(second.lowBalanceEmails).toEqual([]);
    expect(second.dailySpendCapMicro).toBe(250_000_000n);
    expect(await getSettings(t.db, orgA)).toMatchObject({ dailySpendCapMicro: 250_000_000n });
    expect(await getSettings(t.db, orgB)).toMatchObject({ dailySpendCapMicro: null });
  });

  it("records and clears the low balance alert timestamp", async () => {
    const at = new Date("2026-11-06T10:00:00Z");
    await markLowBalanceAlerted(t.db, orgB, at);
    expect((await getSettings(t.db, orgB)).lowBalanceAlertedAt?.getTime()).toBe(at.getTime());
    await markLowBalanceAlerted(t.db, orgB, null);
    expect((await getSettings(t.db, orgB)).lowBalanceAlertedAt).toBeNull();
  });

  it("rejects more than five alert emails", async () => {
    await expect(
      updateSettings(t.db, orgA, {
        lowBalanceThresholdMicro: null,
        lowBalanceEmails: Array.from({ length: 6 }, (_, i) => `a${i}@example.com`),
        dailyMessageCap: null,
        dailySpendCapMicro: null,
      }),
    ).rejects.toThrow(/five/i);
  });
});
