import { describe, expect, it } from "vitest";
import { FakeLookupProvider } from "./lookup.js";

describe("FakeLookupProvider", () => {
  it("answers deterministically by the last digit and prices by country", async () => {
    const provider = new FakeLookupProvider();
    const results = await provider.lookup([
      { e164: "+34600000013", country: "ES" },
      { e164: "+34600000026", country: "ES" },
      { e164: "+34600000038", country: "ES" },
      { e164: "+34600000049", country: "ES" },
      { e164: "+37699000001", country: "AD" },
    ]);
    expect(results.map((r) => [r.status, r.method, r.ported])).toEqual([
      ["hlr", "hlr", false],
      ["mnp", "hlr", true],
      ["unresolved", "hlr", false],
      ["bad", "hlr", false],
      ["local_only", "format", false],
    ]);
    expect(results[0]?.operator).toBe("Vodafone Spain");
    expect(results[3]?.operator).toBeNull();
    expect(await provider.priceFor("gb")).toEqual({
      route: "MNP 331",
      method: "mnp",
      priceMicro: 1_000n,
    });
    expect(await provider.priceFor("AD")).toBeNull();
    expect(provider.seen).toHaveLength(5);
  });
});
