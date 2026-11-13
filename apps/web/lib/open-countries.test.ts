import { describe, expect, it } from "vitest";
import { assertCountryOpen, ClosedCountryError } from "./open-countries";

describe("assertCountryOpen", () => {
  it("lets an open country through", () => {
    expect(() => assertCountryOpen("GB", ["GB"])).not.toThrow();
    expect(() => assertCountryOpen("DE", null)).not.toThrow();
  });

  it("refuses a closed country with a message a user can read", () => {
    expect(() => assertCountryOpen("DE", ["GB"])).toThrow(ClosedCountryError);
    expect(() => assertCountryOpen("DE", ["GB"])).toThrow(
      "Germany is not open yet. Only United Kingdom can be used for now.",
    );
  });
});
