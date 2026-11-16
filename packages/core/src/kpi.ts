/**
 * Pure maths of the KPI screens (D5-03 onwards), built from the Business KPIs Manager
 * walkthrough of 11 November 2026. The vocabulary is Sendex's own: an offer is that tool's
 * "brand", a route its "source", a lead its "SU" (sign-up) and a sale its "FTD".
 *
 * Sends, leads and cost belong to the day the SMS went out; sales and revenue to the day the
 * deposit was made (D4-17). The database helpers do that windowing; these functions only add
 * up and divide.
 */

export interface KpiCounters {
  /** SMS submitted to a carrier. */
  sent: number;
  /** Registrations reported by the tracker. */
  leads: number;
  /** First deposits (one per message). */
  sales: number;
  /** Micro-EUR spent on the sends. */
  costMicro: bigint;
  /** Micro-EUR the sales paid. */
  revenueMicro: bigint;
}

export const ZERO_COUNTERS: KpiCounters = {
  sent: 0,
  leads: 0,
  sales: 0,
  costMicro: 0n,
  revenueMicro: 0n,
};

export function addCounters(a: KpiCounters, b: KpiCounters): KpiCounters {
  return {
    sent: a.sent + b.sent,
    leads: a.leads + b.leads,
    sales: a.sales + b.sales,
    costMicro: a.costMicro + b.costMicro,
    revenueMicro: a.revenueMicro + b.revenueMicro,
  };
}

/** Sales per lead as a fraction (0.15 is 15 %); null without leads. */
export function leadToSale(c: Pick<KpiCounters, "leads" | "sales">): number | null {
  return c.leads > 0 ? c.sales / c.leads : null;
}

export function profitMicro(c: Pick<KpiCounters, "costMicro" | "revenueMicro">): bigint {
  return c.revenueMicro - c.costMicro;
}

/**
 * Profit over cost as a fraction (1.5 is 150 %), the dashboard's definition of ROI; null
 * without cost. The tool in the recording shows revenue over cost under the same name, which
 * reads 100 points higher; Sendex keeps one definition everywhere.
 */
export function roi(c: Pick<KpiCounters, "costMicro" | "revenueMicro">): number | null {
  return c.costMicro > 0n ? Number(profitMicro(c)) / Number(c.costMicro) : null;
}

/** How many SMS it took to get one sale ("contacts per FTD"), rounded; null without sales. */
export function smsPerSale(c: Pick<KpiCounters, "sent" | "sales">): number | null {
  return c.sales > 0 ? Math.round(c.sent / c.sales) : null;
}

function perSale(micro: bigint, sales: number): bigint | null {
  return sales > 0 ? micro / BigInt(sales) : null;
}

export function costPerSaleMicro(c: Pick<KpiCounters, "costMicro" | "sales">): bigint | null {
  return perSale(c.costMicro, c.sales);
}

export function revenuePerSaleMicro(c: Pick<KpiCounters, "revenueMicro" | "sales">): bigint | null {
  return perSale(c.revenueMicro, c.sales);
}

export function profitPerSaleMicro(
  c: Pick<KpiCounters, "costMicro" | "revenueMicro" | "sales">,
): bigint | null {
  return perSale(profitMicro(c), c.sales);
}

/** Best first by a nullable number; nulls last. */
function byDesc(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return b - a;
}

// ---------------------------------------------------------------------------
// List Follow-Up (D5-03)
// ---------------------------------------------------------------------------

export interface ListFollowUpRow extends KpiCounters {
  listId: string;
  name: string;
  country: string;
  /** Who supplied the data (D5-01); null when not set. */
  provider: string | null;
  numbersCount: number;
  /** The last send inside the filters; null when the list was not sent in them. */
  lastSentAt: Date | null;
  createdAt: Date;
}

export interface CountryFollowUp extends KpiCounters {
  country: string;
  /** Lists of the country that were sent inside the filters. */
  totalLists: number;
  lastSentAt: Date | null;
  lists: ListFollowUpRow[];
}

export interface ListFollowUp {
  /** Countries with at least one sent list, best ROI first. */
  countries: CountryFollowUp[];
  /** Lists with no send inside the filters ("never sent"), by country then name. */
  untouched: ListFollowUpRow[];
}

/**
 * The List Follow-Up table: lists that were sent, grouped by country with the country's
 * totals, and the lists that were not touched. A list counts as sent when it has at least one
 * SMS or one sale inside the filters.
 */
export function groupListFollowUp(rows: readonly ListFollowUpRow[]): ListFollowUp {
  const used = rows.filter((r) => r.sent > 0 || r.sales > 0);
  const untouched = rows
    .filter((r) => r.sent === 0 && r.sales === 0)
    .sort((a, b) => a.country.localeCompare(b.country) || a.name.localeCompare(b.name));

  const byCountry = new Map<string, ListFollowUpRow[]>();
  for (const row of used) {
    const lists = byCountry.get(row.country) ?? [];
    lists.push(row);
    byCountry.set(row.country, lists);
  }
  const countries: CountryFollowUp[] = [...byCountry.entries()].map(([country, lists]) => {
    const totals = lists.reduce<KpiCounters>((sum, l) => addCounters(sum, l), ZERO_COUNTERS);
    const lastSentAt = lists.reduce<Date | null>(
      (latest, l) =>
        l.lastSentAt && (latest === null || l.lastSentAt > latest) ? l.lastSentAt : latest,
      null,
    );
    return {
      ...totals,
      country,
      totalLists: lists.length,
      lastSentAt,
      lists: [...lists].sort((a, b) => b.sales - a.sales || a.name.localeCompare(b.name)),
    };
  });
  countries.sort((a, b) => byDesc(roi(a), roi(b)) || a.country.localeCompare(b.country));
  return { countries, untouched };
}

// ---------------------------------------------------------------------------
// Performance Insight (D5-04)
// ---------------------------------------------------------------------------

/** One offer in one country: the grain every Insight figure is built from. */
export interface OfferCountryRow extends KpiCounters {
  country: string;
  /** Null for messages that carried no tracked link. */
  offerId: string | null;
  offer: string;
}

export interface InsightTotals extends KpiCounters {
  profitMicro: bigint;
  costPerSaleMicro: bigint | null;
  revenuePerSaleMicro: bigint | null;
  profitPerSaleMicro: bigint | null;
  smsPerSale: number | null;
}

function sum(rows: readonly KpiCounters[]): KpiCounters {
  return rows.reduce<KpiCounters>((total, r) => addCounters(total, r), ZERO_COUNTERS);
}

/** The eight tiles: sales, revenue, cost, profit and the four per-sale figures. */
export function insightTotals(rows: readonly KpiCounters[]): InsightTotals {
  const totals = sum(rows);
  return {
    ...totals,
    profitMicro: profitMicro(totals),
    costPerSaleMicro: costPerSaleMicro(totals),
    revenuePerSaleMicro: revenuePerSaleMicro(totals),
    profitPerSaleMicro: profitPerSaleMicro(totals),
    smsPerSale: smsPerSale(totals),
  };
}

export interface RollUpRow extends KpiCounters {
  /** The offer name or the country code. */
  label: string;
}

/** Totals per offer or per country, most sales first, then most revenue, then by name. */
export function rollUp(rows: readonly OfferCountryRow[], by: "offer" | "country"): RollUpRow[] {
  const groups = new Map<string, KpiCounters>();
  for (const row of rows) {
    const label = by === "offer" ? row.offer : row.country;
    groups.set(label, addCounters(groups.get(label) ?? ZERO_COUNTERS, row));
  }
  return [...groups.entries()]
    .map(([label, counters]) => ({ ...counters, label }))
    .sort(
      (a, b) =>
        b.sales - a.sales ||
        Number(b.revenueMicro - a.revenueMicro) ||
        a.label.localeCompare(b.label),
    );
}

export interface CountryOffers {
  country: string;
  /** Sales of the whole country, not only of the offers shown. */
  sales: number;
  offers: OfferCountryRow[];
}

/**
 * "Offer performance by country": for each country, its best offers by ROI or by sales.
 * Countries come most sales first. An offer without cost has no ROI and goes last.
 */
export function topOffersByCountry(
  rows: readonly OfferCountryRow[],
  sort: "roi" | "sales",
  top = 5,
): CountryOffers[] {
  const byCountry = new Map<string, OfferCountryRow[]>();
  for (const row of rows) {
    const list = byCountry.get(row.country) ?? [];
    list.push(row);
    byCountry.set(row.country, list);
  }
  return [...byCountry.entries()]
    .map(([country, offers]) => ({
      country,
      sales: offers.reduce((n, o) => n + o.sales, 0),
      offers: [...offers]
        .sort((a, b) =>
          sort === "roi"
            ? byDesc(roi(a), roi(b)) || b.sales - a.sales || a.offer.localeCompare(b.offer)
            : b.sales - a.sales || byDesc(roi(a), roi(b)) || a.offer.localeCompare(b.offer),
        )
        .slice(0, top),
    }))
    .sort((a, b) => b.sales - a.sales || a.country.localeCompare(b.country));
}

export interface EfficiencyRow {
  offer: string;
  smsPerSale: number;
  sales: number;
}

/** "SMS per sale": the offers that need the fewest SMS to get one sale, best first. */
export function efficiencySnapshot(rows: readonly OfferCountryRow[], top = 6): EfficiencyRow[] {
  return rollUp(rows, "offer")
    .flatMap((o) => {
      const perSale = smsPerSale(o);
      return perSale === null ? [] : [{ offer: o.label, smsPerSale: perSale, sales: o.sales }];
    })
    .sort((a, b) => a.smsPerSale - b.smsPerSale || a.offer.localeCompare(b.offer))
    .slice(0, top);
}
