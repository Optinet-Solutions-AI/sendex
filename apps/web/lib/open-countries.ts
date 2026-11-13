import {
  closedCountryMessage,
  isCountryOpen,
  type OpenCountries,
  parseOpenCountries,
} from "@sendex/core";

/**
 * The countries a user can pick for a new campaign, a single SMS or a new list (D4-19).
 * Read from `NEXT_PUBLIC_OPEN_COUNTRIES` when the app is built: blank means the United
 * Kingdom only, `all` opens every country, otherwise a list of 2-letter codes. The same
 * value is used in the browser (to grey out the closed countries) and in the server actions
 * (to refuse them).
 */
export const OPEN_COUNTRIES = parseOpenCountries(process.env.NEXT_PUBLIC_OPEN_COUNTRIES);

/** Thrown by a server action when the country is not open; the message is safe to show. */
export class ClosedCountryError extends Error {
  constructor(country: string, open: readonly string[]) {
    super(closedCountryMessage(country, open));
    this.name = "ClosedCountryError";
  }
}

/** The server-side half of the greyed-out dropdown options: refuse a closed country. */
export function assertCountryOpen(country: string, open: OpenCountries = OPEN_COUNTRIES): void {
  if (open !== null && !isCountryOpen(country, open)) throw new ClosedCountryError(country, open);
}
