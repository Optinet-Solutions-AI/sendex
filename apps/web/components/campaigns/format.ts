import { cpc, ctr, deliveryRate } from "@sendex/core";
import { formatInTimeZone } from "date-fns-tz";

const MICRO = 1_000_000;

const eur = new Intl.NumberFormat("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const eur4 = new Intl.NumberFormat("en-GB", { minimumFractionDigits: 4, maximumFractionDigits: 4 });

export function formatEur(amount: number): string {
  return `EUR ${eur.format(amount)}`;
}

/** Micro-EUR (number, bigint or the string a JSON boundary turns a bigint into) as EUR. */
export function formatMicro(micro: number | bigint | string): string {
  return formatEur(Number(micro) / MICRO);
}

export function formatPricePerSms(priceMicro: number | bigint | string | null): string {
  if (priceMicro === null) return "no price";
  return `EUR ${eur4.format(Number(priceMicro) / MICRO)}`;
}

export function formatPercent(ratio: number): string {
  return `${(ratio * 100).toFixed(2)}%`;
}

export function formatDateTime(iso: string | Date, timezone: string): string {
  return formatInTimeZone(iso, timezone, "d MMM yyyy HH:mm");
}

/** "14 Sep 2026 12:00 – 14:30" (same day) or two full stamps; "–" when nothing happened yet. */
export function formatPeriod(
  start: string | Date | null,
  end: string | Date | null,
  timezone: string,
): string {
  if (!start) return "–";
  const from = formatDateTime(start, timezone);
  if (!end) return `${from} –`;
  const sameDay =
    formatInTimeZone(start, timezone, "yyyy-MM-dd") ===
    formatInTimeZone(end, timezone, "yyyy-MM-dd");
  const to = sameDay ? formatInTimeZone(end, timezone, "HH:mm") : formatDateTime(end, timezone);
  return `${from} – ${to}`;
}

export interface LapCounters {
  sent: number;
  delivered: number;
  failed: number;
  clicks: number;
  leads: number;
  sales: number;
  costMicro: number | bigint | string;
}

export interface CampaignTotals {
  sent: number;
  delivered: number;
  /** Rejected at submit, reported undelivered, or expired without a receipt. */
  failed: number;
  /** Delivered per message sent. */
  deliveryRate: number;
  clicks: number;
  ctr: number;
  leads: number;
  sales: number;
  costMicro: number;
  cpcMicro: number | null;
  cplMicro: number | null;
  cpsMicro: number | null;
}

function per(costMicro: number, count: number): number | null {
  return count > 0 ? Math.round(costMicro / count) : null;
}

/**
 * Totals of a campaign (or a single lap) from lap counters. Rates come from
 * `@sendex/core` so the header, the lap table and the analytics tables agree.
 */
export function campaignTotals(laps: readonly LapCounters[]): CampaignTotals {
  let sent = 0;
  let delivered = 0;
  let failed = 0;
  let clicks = 0;
  let leads = 0;
  let sales = 0;
  let costMicro = 0;
  for (const lap of laps) {
    sent += lap.sent;
    delivered += lap.delivered;
    failed += lap.failed;
    clicks += lap.clicks;
    leads += lap.leads;
    sales += lap.sales;
    costMicro += Number(lap.costMicro);
  }
  return {
    sent,
    delivered,
    failed,
    deliveryRate: deliveryRate(delivered, sent),
    clicks,
    ctr: ctr(clicks, sent),
    leads,
    sales,
    costMicro,
    cpcMicro: cpc(costMicro, clicks),
    cplMicro: per(costMicro, leads),
    cpsMicro: per(costMicro, sales),
  };
}

export function formatPer(micro: number | null): string {
  return micro === null ? "–" : formatMicro(micro);
}

function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function toCsv(rows: readonly (readonly string[])[]): string {
  return rows.map((row) => row.map(csvField).join(",")).join("\r\n");
}

export function shortId(id: string): string {
  return id.split("-")[0] ?? id;
}
