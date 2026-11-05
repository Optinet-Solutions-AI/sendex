import { describe, expect, it } from "vitest";
import { campaignsListInput, campaignsQueryString, parseCampaignsQuery } from "./campaigns-params";

describe("parseCampaignsQuery", () => {
  it("falls back to safe defaults", () => {
    expect(parseCampaignsQuery({})).toEqual({
      search: "",
      country: "",
      status: "",
      from: "",
      to: "",
      hasLeads: false,
      hasSales: false,
      noClicks: false,
      spendMin: "",
      spendMax: "",
      page: 1,
    });
  });

  it("keeps valid values and drops invalid ones", () => {
    expect(
      parseCampaignsQuery({
        search: "  roy ",
        country: "es",
        status: "sending",
        from: "2026-09-01",
        to: "2026-13-40",
        hasLeads: "1",
        hasSales: "0",
        noClicks: "on",
        spendMin: "12.5",
        spendMax: "abc",
        page: "3",
      }),
    ).toEqual({
      search: "roy",
      country: "ES",
      status: "sending",
      from: "2026-09-01",
      to: "",
      hasLeads: true,
      hasSales: false,
      noClicks: true,
      spendMin: "12.5",
      spendMax: "",
      page: 3,
    });
    expect(parseCampaignsQuery({ status: "bogus", country: "ESP", page: "-2" })).toMatchObject({
      status: "",
      country: "",
      page: 1,
    });
  });
});

describe("campaignsQueryString", () => {
  it("writes only the non-default filters", () => {
    expect(campaignsQueryString({})).toBe("");
    expect(
      campaignsQueryString({
        search: "roy",
        country: "ES",
        hasSales: true,
        spendMin: "10",
        page: 2,
      }),
    ).toBe("?search=roy&country=ES&hasSales=1&spendMin=10&page=2");
  });
});

describe("campaignsListInput", () => {
  it("converts days to [from, to) instants and EUR to micro-EUR", () => {
    const input = campaignsListInput({
      ...parseCampaignsQuery({
        from: "2026-09-01",
        to: "2026-09-30",
        spendMin: "1.5",
        spendMax: "100",
        hasLeads: "1",
        status: "completed",
      }),
      page: 2,
    });
    expect(input).toEqual({
      page: 2,
      status: "completed",
      from: new Date("2026-09-01T00:00:00Z"),
      to: new Date("2026-10-01T00:00:00Z"),
      hasLeads: true,
      spendMinMicro: 1_500_000n,
      spendMaxMicro: 100_000_000n,
    });
  });

  it("leaves unset filters out so the old query path is unchanged", () => {
    expect(campaignsListInput(parseCampaignsQuery({}))).toEqual({ page: 1 });
  });
});
