import type { SaveCarrierBalanceInput } from "@sendex/db";
import type { CarrierBalance, Provider } from "@sendex/providers";
import { createProviderRegistry } from "@sendex/providers";
import { describe, expect, it } from "vitest";
import { createCarrierBalanceRefresher } from "./carrier-balance.js";

function carrier(name: string, answers: Array<CarrierBalance | Error>): Provider {
  return {
    name,
    send: async () => [],
    parseDeliveryReceipt: () => null,
    priceFor: async () => null,
    validateSenderId: () => ({ ok: true }),
    fetchBalance: async () => {
      const next = answers.shift();
      if (!next) throw new Error("no answer scripted");
      if (next instanceof Error) throw next;
      return next;
    },
  };
}

const plain: Provider = {
  name: "fake",
  send: async () => [],
  parseDeliveryReceipt: () => null,
  priceFor: async () => null,
  validateSenderId: () => ({ ok: true }),
};

const eur = (micro: bigint): CarrierBalance => ({
  balanceMicro: micro,
  currency: "EUR",
  reportedAt: null,
});

describe("carrier balance refresher (D5-17)", () => {
  it("reads every carrier that has a balance and stores it", async () => {
    const saved: SaveCarrierBalanceInput[] = [];
    const registry = createProviderRegistry()
      .register("23telecom", carrier("23telecom", [eur(417_360_500n)]))
      .register("fake", plain);
    const now = new Date("2026-11-25T14:00:00Z");
    const refresher = createCarrierBalanceRefresher({
      providers: registry,
      save: async (input) => {
        saved.push(input);
      },
      log: () => {},
      now: () => now,
    });
    await refresher.refresh();
    expect(saved).toEqual([
      {
        provider: "23telecom",
        balanceMicro: 417_360_500n,
        currency: "EUR",
        reportedAt: null,
        checkedAt: now,
      },
    ]);
  });

  it("reads again only when the last read is older than asked", async () => {
    const saved: bigint[] = [];
    let clock = new Date("2026-11-25T14:00:00Z").getTime();
    const refresher = createCarrierBalanceRefresher({
      providers: createProviderRegistry().register(
        "23telecom",
        carrier("23telecom", [eur(3n), eur(2n), eur(1n)]),
      ),
      save: async (input) => {
        saved.push(input.balanceMicro);
      },
      log: () => {},
      now: () => new Date(clock),
    });
    await refresher.refresh(60_000);
    clock += 30_000;
    await refresher.refresh(60_000);
    clock += 31_000;
    await refresher.refresh(60_000);
    await refresher.refresh(0);
    expect(saved).toEqual([3n, 2n, 1n]);
  });

  it("logs a carrier that cannot be read and keeps the last stored balance", async () => {
    const saved: bigint[] = [];
    const lines: string[] = [];
    const refresher = createCarrierBalanceRefresher({
      providers: createProviderRegistry().register(
        "23telecom",
        carrier("23telecom", [new Error("23telecom balance answered 401 UNAUTHORIZED")]),
      ),
      save: async (input) => {
        saved.push(input.balanceMicro);
      },
      log: (_level, msg) => {
        lines.push(msg);
      },
    });
    await expect(refresher.refresh()).resolves.toBeUndefined();
    expect(saved).toEqual([]);
    expect(lines).toEqual(["carrier balance read failed"]);
  });
});
