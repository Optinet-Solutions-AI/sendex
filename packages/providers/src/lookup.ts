/**
 * Network lookups (HLR / MNP) behind one interface, the way carriers are. Only the worker
 * calls it. The real provider arrives when an account exists; `FakeLookupProvider` serves
 * development and tests with deterministic answers.
 */

export type LookupMethod = "hlr" | "mnp";

export interface LookupNumber {
  e164: string;
  country: string;
}

export interface LookupResult {
  e164: string;
  /** hlr, mnp, unresolved, local_only or bad (blacklisted is decided by Sendex, not the carrier). */
  status: "hlr" | "mnp" | "unresolved" | "local_only" | "bad";
  method: LookupMethod | "format";
  operator: string | null;
  ported: boolean;
}

export interface LookupPrice {
  route: string;
  method: LookupMethod;
  /** Micro-EUR per number. */
  priceMicro: bigint;
}

export interface LookupProvider {
  readonly name: string;
  /** Look numbers up; never throws per number, reports each in the results. */
  lookup(numbers: readonly LookupNumber[]): Promise<LookupResult[]>;
  /** The route, method and price per number for a country, or null when it has none. */
  priceFor(country: string): Promise<LookupPrice | null>;
}

const FAKE_OPERATORS: Record<string, readonly string[]> = {
  ES: ["Movistar", "Vodafone Spain", "Orange Spain", "Yoigo"],
  FR: ["Orange S.A.", "SFR", "Bouygues Telecom", "Free Mobile"],
  GB: ["EE", "Vodafone", "O2", "Three"],
  DE: ["Telekom Deutschland", "Vodafone D2", "Telefónica Germany"],
  PL: ["Orange Polska", "Plus", "Play", "T-Mobile Polska"],
};

const FAKE_PRICES: Record<string, LookupPrice> = {
  ES: { route: "HLR 210", method: "hlr", priceMicro: 4_000n },
  FR: { route: "HLR 210", method: "hlr", priceMicro: 4_500n },
  GB: { route: "MNP 331", method: "mnp", priceMicro: 1_000n },
  DE: { route: "HLR 210", method: "hlr", priceMicro: 6_000n },
  PL: { route: "MNP 331", method: "mnp", priceMicro: 1_200n },
  MT: { route: "HLR 210", method: "hlr", priceMicro: 5_000n },
  PT: { route: "MNP 331", method: "mnp", priceMicro: 1_100n },
};

/**
 * Deterministic lookups for development: the number's last digit decides the status
 * (0–5 HLR-checked, 6–7 ported, 8 unresolved, 9 bad), the second-last digit the operator.
 */
export class FakeLookupProvider implements LookupProvider {
  readonly name = "fake-lookup";
  readonly seen: LookupNumber[] = [];

  async lookup(numbers: readonly LookupNumber[]): Promise<LookupResult[]> {
    return numbers.map((n) => {
      this.seen.push(n);
      const digits = n.e164.replace(/\D/g, "");
      const last = Number(digits.at(-1) ?? "0");
      const secondLast = Number(digits.at(-2) ?? "0");
      const price = FAKE_PRICES[n.country.toUpperCase()];
      const operators = FAKE_OPERATORS[n.country.toUpperCase()] ?? ["Unknown Mobile"];
      const operator = operators[secondLast % operators.length] ?? null;
      if (!price)
        return {
          e164: n.e164,
          status: "local_only",
          method: "format",
          operator: null,
          ported: false,
        };
      if (last === 9)
        return { e164: n.e164, status: "bad", method: price.method, operator: null, ported: false };
      if (last === 8)
        return {
          e164: n.e164,
          status: "unresolved",
          method: price.method,
          operator: null,
          ported: false,
        };
      if (last >= 6)
        return { e164: n.e164, status: "mnp", method: price.method, operator, ported: true };
      return { e164: n.e164, status: "hlr", method: price.method, operator, ported: false };
    });
  }

  async priceFor(country: string): Promise<LookupPrice | null> {
    return FAKE_PRICES[country.toUpperCase()] ?? null;
  }
}
