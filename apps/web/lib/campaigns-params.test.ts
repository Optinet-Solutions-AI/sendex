import { describe, expect, it } from "vitest";
import { campaignsListInput, campaignsQueryString, parseCampaignsQuery } from "./campaigns-params";

describe("parseCampaignsQuery", () => {
  it("falls back to safe defaults", () => {
    expect(parseCampaignsQuery({})).toEqual({
      search: "",
      countries: [],
      status: "",
      from: "",
      to: "",
      hasLeads: false,
      hasSales: false,
      noClicks: false,
      spendMin: "",
      spendMax: "",
      page: 1,
      sort: "",
      dir: "desc",
      offer: "",
      sender: "",
      clicksMin: "",
      leadsMin: "",
      salesMin: "",
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
      countries: ["ES"],
      status: "sending",
      from: "2026-09-01",
      to: "",
      hasLeads: true,
      hasSales: false,
      noClicks: true,
      spendMin: "12.5",
      spendMax: "",
      page: 3,
      sort: "",
      dir: "desc",
      offer: "",
      sender: "",
      clicksMin: "",
      leadsMin: "",
      salesMin: "",
    });
    expect(parseCampaignsQuery({ status: "bogus", country: "ESP", page: "-2" })).toMatchObject({
      status: "",
      countries: [],
      page: 1,
      sort: "",
      dir: "desc",
    });
  });
});

describe("campaignsQueryString", () => {
  it("writes only the non-default filters", () => {
    expect(campaignsQueryString({})).toBe("");
    expect(
      campaignsQueryString({
        search: "roy",
        countries: ["ES"],
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

describe("offer, sender id and minimum results (D4-13)", () => {
  const OFFER = "0d4d9d2e-3a5f-4b3c-8e9f-6a7b8c9d0e1f";

  it("reads the new filters and drops malformed ones", () => {
    const q = parseCampaignsQuery({
      offer: OFFER,
      sender: "  LUCKY ",
      clicksMin: "5",
      leadsMin: "2",
      salesMin: "1",
    });
    expect(q).toMatchObject({
      offer: OFFER,
      sender: "LUCKY",
      clicksMin: "5",
      leadsMin: "2",
      salesMin: "1",
    });
    const bad = parseCampaignsQuery({
      offer: "nope",
      clicksMin: "-3",
      leadsMin: "x",
      salesMin: "1.5",
    });
    expect(bad).toMatchObject({ offer: "", clicksMin: "", leadsMin: "", salesMin: "" });
  });

  it("keeps them in the URL and passes them to the list query", () => {
    const q = parseCampaignsQuery({ offer: OFFER, sender: "LUCKY", clicksMin: "5", salesMin: "1" });
    expect(campaignsQueryString(q)).toBe(`?offer=${OFFER}&sender=LUCKY&clicksMin=5&salesMin=1`);
    expect(campaignsListInput(q)).toMatchObject({
      linkId: OFFER,
      senderId: "LUCKY",
      clicksMin: 5,
      salesMin: 1,
    });
    const none = campaignsListInput(parseCampaignsQuery({}));
    for (const key of ["linkId", "senderId", "clicksMin", "leadsMin", "salesMin"]) {
      expect(none).not.toHaveProperty(key);
    }
  });
});

describe("sorting (D4-10)", () => {
  it("reads a known sort column and direction, and drops anything else", () => {
    const q = parseCampaignsQuery({ sort: "sent", dir: "asc" });
    expect([q.sort, q.dir]).toEqual(["sent", "asc"]);
    const bad = parseCampaignsQuery({ sort: "password", dir: "sideways" });
    expect([bad.sort, bad.dir]).toEqual(["", "desc"]);
  });

  it("keeps the sort in the URL and passes it to the list query", () => {
    const q = parseCampaignsQuery({ status: "sending", sort: "ctr", dir: "asc", page: "2" });
    expect(campaignsQueryString(q)).toBe("?status=sending&page=2&sort=ctr&dir=asc");
    expect(campaignsListInput(q)).toMatchObject({ sort: "ctr", dir: "asc" });
    // Descending is the default direction, so it stays out of the URL.
    expect(campaignsQueryString({ sort: "cost", dir: "desc" })).toBe("?sort=cost");
    expect(campaignsListInput(parseCampaignsQuery({}))).not.toHaveProperty("sort");
  });
});
