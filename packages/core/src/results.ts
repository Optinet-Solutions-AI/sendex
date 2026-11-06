/**
 * Derived numbers of the campaign results screens (D3-05 / D3-06): rates as plain ratios,
 * cost-per-X in micro-EUR with integer arithmetic. Pure; the db layer and the web
 * components both call these so the header, the lap table and the CSV agree.
 */

export interface ResultCounters {
  sent: number;
  delivered: number;
  failed: number;
  clicks: number;
  leads: number;
  sales: number;
  costMicro: bigint;
}

export interface ResultRates {
  /** Clicks per message sent. */
  ctr: number;
  /** Delivered per message sent. */
  deliveryRate: number;
  /** Failed per message sent. */
  failureRate: number;
  /** Cost per click in micro-EUR; null without clicks. */
  cpcMicro: bigint | null;
  /** Cost per lead in micro-EUR; null without leads. */
  cplMicro: bigint | null;
  /** Cost per sale in micro-EUR; null without sales. */
  cpsMicro: bigint | null;
}

/** `part / whole`, or 0 when there is no `whole`. */
export function ratioOf(part: number, whole: number): number {
  return whole > 0 ? part / whole : 0;
}

/** Micro-EUR per unit, rounded half up without leaving integers; null when `count` is 0. */
export function costPerMicro(costMicro: bigint, count: number): bigint | null {
  if (count <= 0) return null;
  const divisor = BigInt(count);
  return (costMicro + divisor / 2n) / divisor;
}

export function resultRates(c: ResultCounters): ResultRates {
  return {
    ctr: ratioOf(c.clicks, c.sent),
    deliveryRate: ratioOf(c.delivered, c.sent),
    failureRate: ratioOf(c.failed, c.sent),
    cpcMicro: costPerMicro(c.costMicro, c.clicks),
    cplMicro: costPerMicro(c.costMicro, c.leads),
    cpsMicro: costPerMicro(c.costMicro, c.sales),
  };
}

export function sumResultCounters(rows: readonly ResultCounters[]): ResultCounters {
  const total: ResultCounters = {
    sent: 0,
    delivered: 0,
    failed: 0,
    clicks: 0,
    leads: 0,
    sales: 0,
    costMicro: 0n,
  };
  for (const row of rows) {
    total.sent += row.sent;
    total.delivered += row.delivered;
    total.failed += row.failed;
    total.clicks += row.clicks;
    total.leads += row.leads;
    total.sales += row.sales;
    total.costMicro += row.costMicro;
  }
  return total;
}

/** A ratio as "12.34%". */
export function formatPercent(ratio: number, decimals = 2): string {
  return `${(ratio * 100).toFixed(decimals)}%`;
}
