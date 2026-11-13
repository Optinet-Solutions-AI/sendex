import { describe, expect, it } from "vitest";
import {
  closedCountryMessage,
  DEFAULT_OPEN_COUNTRIES,
  defaultOpenCountry,
  isCountryOpen,
  openCountriesHint,
  parseOpenCountries,
} from "./open-countries.js";

describe("parseOpenCountries", () => {
  it("opens only the United Kingdom when nothing is set", () => {
    expect(DEFAULT_OPEN_COUNTRIES).toEqual(["GB"]);
    expect(parseOpenCountries(undefined)).toEqual(["GB"]);
    expect(parseOpenCountries("")).toEqual(["GB"]);
    expect(parseOpenCountries("   ")).toEqual(["GB"]);
  });

  it("opens every country for 'all' or '*'", () => {
    expect(parseOpenCountries("all")).toBeNull();
    expect(parseOpenCountries(" ALL ")).toBeNull();
    expect(parseOpenCountries("*")).toBeNull();
  });

  it("reads a list of 2-letter codes, in any case, once each", () => {
    expect(parseOpenCountries("gb, es;DE  gb")).toEqual(["GB", "ES", "DE"]);
  });

  it("falls back to the United Kingdom when no code in the value is valid", () => {
    expect(parseOpenCountries("germany, 12")).toEqual(["GB"]);
  });
});

describe("isCountryOpen", () => {
  it("is true only for a listed country", () => {
    expect(isCountryOpen("GB", ["GB"])).toBe(true);
    expect(isCountryOpen("gb", ["GB"])).toBe(true);
    expect(isCountryOpen("DE", ["GB"])).toBe(false);
  });

  it("is true for every country when all are open", () => {
    expect(isCountryOpen("DE", null)).toBe(true);
  });
});

describe("defaultOpenCountry", () => {
  it("keeps the preferred country when it is open", () => {
    expect(defaultOpenCountry("ES", null)).toBe("ES");
    expect(defaultOpenCountry("ES", ["GB", "ES"])).toBe("ES");
  });

  it("uses the first open country otherwise", () => {
    expect(defaultOpenCountry("ES", ["GB"])).toBe("GB");
  });
});

describe("wording", () => {
  it("names the open countries in the hint", () => {
    expect(openCountriesHint(["GB"])).toBe(
      "Only United Kingdom is open for now. The other countries are shown but cannot be picked.",
    );
    expect(openCountriesHint(["GB", "ES", "DE"])).toBe(
      "Only United Kingdom, Spain and Germany are open for now. The other countries are shown but cannot be picked.",
    );
  });

  it("has no hint when every country is open", () => {
    expect(openCountriesHint(null)).toBeNull();
  });

  it("says which country is closed and which are open", () => {
    expect(closedCountryMessage("DE", ["GB"])).toBe(
      "Germany is not open yet. Only United Kingdom can be used for now.",
    );
  });
});
