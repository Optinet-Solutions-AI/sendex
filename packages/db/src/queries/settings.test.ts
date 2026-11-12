import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, seedOrganisation, type TestDb } from "../test/db.js";
import {
  getSendingHours,
  getSettings,
  markLowBalanceAlerted,
  updateSendingHours,
  updateSettings,
} from "./settings.js";

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

// D4-14: suggested sending hours, a default window plus per-country windows.
describe("sending hours", () => {
  const hours = {
    default: { from: "09:00", to: "20:00" },
    countries: { ES: { from: "10:00", to: "21:00" } },
  };

  it("are empty until someone saves them", async () => {
    expect(await getSendingHours(t.db, orgB)).toEqual({ default: null, countries: {} });
  });

  it("are saved per organisation and replaced on the next save", async () => {
    await updateSendingHours(t.db, orgB, hours);
    expect(await getSendingHours(t.db, orgB)).toEqual(hours);
    expect(await getSendingHours(t.db, orgA)).toEqual({ default: null, countries: {} });
    await updateSendingHours(t.db, orgB, { default: null, countries: {} });
    expect(await getSendingHours(t.db, orgB)).toEqual({ default: null, countries: {} });
  });

  it("leave the billing settings alone, and the other way round", async () => {
    await updateSendingHours(t.db, orgA, hours);
    await updateSettings(t.db, orgA, {
      lowBalanceThresholdMicro: 5_000_000n,
      lowBalanceEmails: [],
      dailyMessageCap: 100,
      dailySpendCapMicro: null,
    });
    expect(await getSendingHours(t.db, orgA)).toEqual(hours);
    await updateSendingHours(t.db, orgA, { default: null, countries: {} });
    expect((await getSettings(t.db, orgA)).dailyMessageCap).toBe(100);
  });

  it("refuses hours that do not validate", async () => {
    await expect(
      updateSendingHours(t.db, orgA, { default: { from: "20:00", to: "09:00" }, countries: {} }),
    ).rejects.toThrow();
  });
});
