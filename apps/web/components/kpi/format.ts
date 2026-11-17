import { formatEur } from "@sendex/core";
import { formatPricePerSms } from "../campaigns/format";

/** Shared formatting of the KPI screens (D5-03 onwards). */

/** "15.0%" from 0.15; an en dash when there is nothing to divide by. */
export function percent(value: number | null, digits = 1): string {
  return value === null ? "–" : `${(value * 100).toFixed(digits)}%`;
}

/** "€1,094.00" from micro-EUR as a string (bigint does not cross the server boundary). */
export function eur(micro: string | null): string {
  return micro === null ? "–" : formatEur(BigInt(micro));
}

/** "11 Nov 2026" in UTC; an en dash for no date. */
export function shortDay(iso: string | null): string {
  if (!iso) return "–";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * A route in the campaign creator's dropdown: "Route 405 · GB (€0.0123/SMS)". The price has
 * four decimals, as on the campaign page; two would show €0.0123 as €0.01 (D5-10).
 */
export function routeChoiceLabel(
  route: { name: string; platform: boolean; priceMicro: string | null },
  country: string,
): string {
  const name = route.platform ? `Route ${route.name}` : route.name;
  const price = route.priceMicro === null ? "" : ` (${formatPricePerSms(route.priceMicro)}/SMS)`;
  return `${name} · ${country}${price}`;
}
