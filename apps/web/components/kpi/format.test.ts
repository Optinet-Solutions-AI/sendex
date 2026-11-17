import { describe, expect, it } from "vitest";
import { routeChoiceLabel } from "./format";

describe("routeChoiceLabel", () => {
  it("shows the price per SMS to four decimals, as the campaign page does", () => {
    expect(routeChoiceLabel({ name: "405", platform: true, priceMicro: "12300" }, "GB")).toBe(
      "Route 405 · GB (€0.0123/SMS)",
    );
  });

  it("keeps an organisation's own route under its own name", () => {
    expect(
      routeChoiceLabel({ name: "Own route", platform: false, priceMicro: "25000" }, "GB"),
    ).toBe("Own route · GB (€0.0250/SMS)");
  });

  it("leaves the price out when the route has none for the country", () => {
    expect(routeChoiceLabel({ name: "Own route", platform: false, priceMicro: null }, "GB")).toBe(
      "Own route · GB",
    );
  });
});
