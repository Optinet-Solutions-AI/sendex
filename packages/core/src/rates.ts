/**
 * Click and delivery rates. Pure: counters in, ratios out. The dashboard, the lap
 * ranking and the per-sender / per-text / per-link breakdowns all derive their
 * percentages from these so the same numbers show the same way everywhere.
 *
 * Rules (docs/using/campaign-results.md):
 * - `sent` is what the carrier accepted; `delivered` what it reported delivered.
 * - CTR is clicks per message sent, with one click per message at most (a recipient who
 *   opens the link three times is one click).
 * - CPC is the cost of the row divided by its clicks; undefined without clicks.
 */

/** Clicks per message sent, 0 when nothing was sent. */
export function ctr(clicks: number, sent: number): number {
  return sent > 0 ? clicks / sent : 0;
}

/** Cost per click in micro-EUR, rounded to the micro; null without clicks. */
export function cpc(costMicro: number | bigint, clicks: number): number | null {
  return clicks > 0 ? Math.round(Number(costMicro) / clicks) : null;
}

/** Delivered per message sent, 0 when nothing was sent. */
export function deliveryRate(delivered: number, sent: number): number {
  return sent > 0 ? delivered / sent : 0;
}

// One percent formatter for the whole package: results.ts owns it.
export { formatPercent } from "./results.js";

export interface ClickCounters {
  sent: number;
  delivered: number;
  clicks: number;
  costMicro: number | bigint;
}

export interface ClickRates {
  ctr: number;
  /** Micro-EUR per click; null without clicks. */
  cpcMicro: number | null;
  deliveryRate: number;
}

/** The three rates from one set of counters. */
export function clickRates(counters: ClickCounters): ClickRates {
  return {
    ctr: ctr(counters.clicks, counters.sent),
    cpcMicro: cpc(counters.costMicro, counters.clicks),
    deliveryRate: deliveryRate(counters.delivered, counters.sent),
  };
}
