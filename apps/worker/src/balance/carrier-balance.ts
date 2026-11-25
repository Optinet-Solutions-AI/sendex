import type { SaveCarrierBalanceInput } from "@sendex/db";
import type { ProviderRegistry } from "@sendex/providers";
import type { Logger } from "../log.js";

/** How often the scheduled tick reads the carriers' balances. */
export const CARRIER_BALANCE_EVERY_MS = 60_000;
/** Before a send or a test, a balance older than this is read again. */
export const CARRIER_BALANCE_BEFORE_SEND_MS = 15_000;

export interface CarrierBalanceRefresherDeps {
  providers: ProviderRegistry;
  save: (input: SaveCarrierBalanceInput) => Promise<void>;
  log: Logger;
  now?: () => Date;
}

export interface CarrierBalanceRefresher {
  /**
   * Read the balance of every carrier that has a balance API and store it, unless the last
   * read is younger than `maxAgeMs` (default: read now). A carrier that cannot be read is
   * logged and keeps its last stored balance; this never throws.
   */
  refresh(maxAgeMs?: number): Promise<void>;
}

/** Keeps `carrier_balances` (D5-17) up to date from the carriers' APIs. */
export function createCarrierBalanceRefresher(
  deps: CarrierBalanceRefresherDeps,
): CarrierBalanceRefresher {
  let lastReadAt = Number.NEGATIVE_INFINITY;
  return {
    async refresh(maxAgeMs = 0) {
      const now = deps.now?.() ?? new Date();
      if (now.getTime() - lastReadAt < maxAgeMs) return;
      lastReadAt = now.getTime();
      for (const name of deps.providers.names()) {
        const provider = deps.providers.get(name);
        if (!provider.fetchBalance) continue;
        try {
          const balance = await provider.fetchBalance();
          await deps.save({ provider: name, ...balance, checkedAt: now });
        } catch (err) {
          deps.log("warn", "carrier balance read failed", { provider: name, err });
        }
      }
    },
  };
}
