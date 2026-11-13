import { countryName } from "./campaigns.js";

/**
 * Countries a user can pick when creating a campaign, sending a single SMS or uploading a
 * list. `null` means every country is open. The other countries stay visible in the
 * dropdowns, greyed out and not selectable (D4-19).
 */
export type OpenCountries = readonly string[] | null;

/** What is open when the setting is not given: the United Kingdom only. */
export const DEFAULT_OPEN_COUNTRIES: readonly string[] = ["GB"];

/**
 * Reads the `NEXT_PUBLIC_OPEN_COUNTRIES` setting: blank is the default (United Kingdom only),
 * `all` or `*` opens every country, anything else is a list of 2-letter codes separated by
 * commas, semicolons or spaces. A value with no valid code falls back to the default, so a
 * typo never opens everything.
 */
export function parseOpenCountries(raw: string | undefined): OpenCountries {
  const value = (raw ?? "").trim();
  if (value === "") return DEFAULT_OPEN_COUNTRIES;
  if (value === "*" || value.toLowerCase() === "all") return null;
  const codes = value
    .split(/[\s,;]+/)
    .map((part) => part.toUpperCase())
    .filter((part) => /^[A-Z]{2}$/.test(part));
  const unique = [...new Set(codes)];
  return unique.length > 0 ? unique : DEFAULT_OPEN_COUNTRIES;
}

export function isCountryOpen(country: string, open: OpenCountries): boolean {
  return open === null || open.includes(country.toUpperCase());
}

/** The country a form starts on: `preferred` when it is open, else the first open one. */
export function defaultOpenCountry(preferred: string, open: OpenCountries): string {
  if (isCountryOpen(preferred, open)) return preferred;
  return open?.[0] ?? preferred;
}

/** "United Kingdom", "United Kingdom and Spain", "United Kingdom, Spain and Germany". */
function openCountryNames(open: readonly string[]): string {
  const names = open.map((code) => countryName(code));
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** The line under a country dropdown; `null` when every country is open. */
export function openCountriesHint(open: OpenCountries): string | null {
  if (open === null) return null;
  const verb = open.length === 1 ? "is" : "are";
  return `Only ${openCountryNames(open)} ${verb} open for now. The other countries are shown but cannot be picked.`;
}

/** What a user reads when a closed country reaches the server or is detected in a file. */
export function closedCountryMessage(country: string, open: readonly string[]): string {
  return `${countryName(country)} is not open yet. Only ${openCountryNames(open)} can be used for now.`;
}
