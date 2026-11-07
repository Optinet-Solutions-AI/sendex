import { countryName, flagEmoji } from "@sendex/core";

/** Display helpers shared by the dashboard tabs. Micro-EUR arrive as numbers (JSON-safe). */

const MICRO = 1_000_000;
const eur2 = new Intl.NumberFormat("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const integer = new Intl.NumberFormat("en-GB");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function eur(micro: number | null | undefined): string {
  if (micro === null || micro === undefined) return "—";
  return `€${eur2.format(micro / MICRO)}`;
}

export function pct(ratio: number | null | undefined, decimals = 2): string {
  if (ratio === null || ratio === undefined) return "—";
  return `${(ratio * 100).toFixed(decimals)}%`;
}

export function int(n: number): string {
  return integer.format(n);
}

/** "2026-11" → "Nov 2026". */
export function monthLabel(month: string): string {
  const m = Number.parseInt(month.slice(5, 7), 10);
  return `${MONTHS[m - 1] ?? month} ${month.slice(0, 4)}`;
}

/** "2026-11-02" → "2 Nov". */
export function weekLabel(day: string): string {
  const m = Number.parseInt(day.slice(5, 7), 10);
  return `${Number.parseInt(day.slice(8, 10), 10)} ${MONTHS[m - 1] ?? ""}`;
}

/** "🇪🇸 Spain", or "Other" untouched. */
export function countryLabel(code: string): string {
  if (code === "Other") return "Other";
  return `${flagEmoji(code)} ${countryName(code)}`;
}
