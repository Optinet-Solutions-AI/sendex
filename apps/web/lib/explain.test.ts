import { FORMULAS } from "@sendex/core";
import { describe, expect, it } from "vitest";
import {
  explainBalance,
  explainCampaignSpend,
  explainCpaCounted,
  explainCpc,
  explainCtr,
  explainCtrDelta,
  explainDealRevenue,
  explainDelivery,
  explainEstimate,
  explainGood,
  explainLateSplit,
  explainNet,
  explainProgress,
  explainShare,
  explainSuccess,
  explainTiming,
  explainTotal,
  explainTrackerAmount,
  explainUnresolved,
  LOCAL_FORMULAS,
} from "./explain";

describe("explainCtr", () => {
  it("divides clicks by sent with the shown result", () => {
    expect(explainCtr(9, 190, "4.74%")).toEqual({
      formula: FORMULAS.ctr,
      working: "9 clicks ÷ 190 sent = 4.74%",
    });
  });
  it("says why there is no CTR without sends", () => {
    expect(explainCtr(0, 0, "0.00%").working).toBe("No SMS sent yet, so 0.00%");
  });
  it("keeps the screen's rounding and groups thousands", () => {
    expect(explainCtr(1, 3, `${((1 / 3) * 100).toFixed(2)}%`).working).toBe(
      "1 click ÷ 3 sent = 33.33%",
    );
    expect(explainCtr(1_234, 56_789, "2.17%").working).toBe("1,234 clicks ÷ 56,789 sent = 2.17%");
  });
  it("takes another formula wording", () => {
    expect(explainCtr(1, 2, "50%", LOCAL_FORMULAS.lookupCtr).formula).toBe(
      LOCAL_FORMULAS.lookupCtr,
    );
  });
});

describe("explainCpc", () => {
  it("divides spend by clicks and says it is cut to four decimals", () => {
    const e = explainCpc("€12.35", 9, "€1.3722");
    expect(e.formula).toBe(FORMULAS.cpc);
    expect(e.working).toBe("€12.35 spend ÷ 9 clicks = €1.3722");
    expect(e.note).toMatch(/cut/);
  });
  it("takes the cost word and note of another screen", () => {
    const e = explainCpc("€5.00", 3, "€1.67", { costWord: "cost", note: "Rounded to the cent." });
    expect(e.working).toBe("€5.00 cost ÷ 3 clicks = €1.67");
    expect(e.note).toBe("Rounded to the cent.");
  });
  it("explains the dash without clicks", () => {
    expect(explainCpc("€3.00", 0, "—").working).toBe("No clicks yet, so no CPC");
  });
});

describe("explainDelivery / explainSuccess / explainShare / explainProgress", () => {
  it("delivery", () => {
    expect(explainDelivery(95, 100, "95.0%").working).toBe("95 delivered ÷ 100 sent = 95.0%");
    expect(explainDelivery(0, 0, "0.0%").working).toBe("No SMS sent yet, so 0.0%");
  });
  it("success rate rounds to whole percent", () => {
    expect(explainSuccess(2, 3, "67%")).toEqual({
      formula: LOCAL_FORMULAS.successRate,
      working: "2 accepted ÷ 3 tests ran = 67%",
    });
    expect(explainSuccess(0, 0, "—").working).toBe("No tests ran yet, so no success rate");
  });
  it("share of country", () => {
    expect(explainShare(250, 1_000, "25.0%").working).toBe(
      "250 operator sent ÷ 1,000 country sent = 25.0%",
    );
  });
  it("progress", () => {
    expect(explainProgress(1_200, 1_500, "80%").working).toBe(
      "1,200 valid rows ÷ 1,500 rows in the file = 80%",
    );
    expect(explainProgress(0, 0, "0%").working).toBe("The file had no rows, so 0%");
  });
});

describe("explainCtrDelta", () => {
  it("subtracts the country CTR in points", () => {
    expect(explainCtrDelta("4.10%", "3.20%", "+0.9")).toEqual({
      formula: LOCAL_FORMULAS.ctrDelta,
      working: "4.10% operator − 3.20% country = +0.9 pts",
    });
  });
});

describe("explainLateSplit", () => {
  it("splits sales into same-day and late", () => {
    expect(explainLateSplit(7, 2)).toBe("5 same day + 2 late = 7 sales");
    expect(explainLateSplit(1, 0)).toBe("1 same day + 0 late = 1 sale");
    expect(explainLateSplit(0, 0)).toBe("No first deposits in this period");
  });
});

describe("explainTiming", () => {
  it("counts whole UTC days", () => {
    expect(
      explainTiming("late", 3, "2026-11-04T23:50:00.000Z", "2026-11-07T00:10:00.000Z"),
    ).toEqual({
      formula: LOCAL_FORMULAS.timing,
      working: "Received 2026-11-07 − SMS sent 2026-11-04 = 3 days, so Late · 3 days",
    });
    expect(
      explainTiming("same_day", 0, "2026-11-07T08:00:00.000Z", "2026-11-07T21:00:00.000Z").working,
    ).toBe("Received 2026-11-07 − SMS sent 2026-11-07 = 0 days, so Same day");
    expect(
      explainTiming("late", 1, "2026-11-06T23:50:00.000Z", "2026-11-07T00:10:00.000Z").working,
    ).toBe("Received 2026-11-07 − SMS sent 2026-11-06 = 1 day, so Late · 1 day");
  });
  it("explains a postback with no SMS", () => {
    expect(explainTiming(null, null, null, "2026-11-07T00:10:00.000Z").working).toBe(
      "No SMS carried this dynamic id, so there is no timing",
    );
  });
});

describe("explainDealRevenue", () => {
  it("is the deal CPA for a first deposit", () => {
    expect(explainDealRevenue({ type: "sale", attributed: true, shown: "€250.00" })).toEqual({
      formula: LOCAL_FORMULAS.dealRevenue,
      working: "1 first deposit at €250.00 = €250.00",
    });
  });
  it("says why there is none", () => {
    expect(explainDealRevenue({ type: "lead", attributed: true, shown: null }).working).toBe(
      "A lead earns nothing; only first deposits earn revenue",
    );
    expect(explainDealRevenue({ type: "sale", attributed: false, shown: null }).working).toBe(
      "Matched no SMS, so it earns nothing",
    );
    expect(explainDealRevenue({ type: "sale", attributed: true, shown: null }).working).toMatch(
      /repeat deposit/,
    );
  });
});

describe("explainTrackerAmount", () => {
  it("is not revenue", () => {
    expect(explainTrackerAmount("€100.00")).toEqual({
      formula: LOCAL_FORMULAS.trackerAmount,
      working: "The tracker sent €100.00; Sendex does not count it as revenue",
    });
    expect(explainTrackerAmount(null).working).toBe("The tracker sent no amount");
  });
});

describe("explainCpaCounted", () => {
  it("reads the euro CPA", () => {
    expect(explainCpaCounted("€200 CPA + 40% rev + €20 base", "€200.00", null)).toEqual({
      formula: LOCAL_FORMULAS.cpaCounted,
      working: "“€200 CPA + 40% rev + €20 base” → €200.00 per first deposit",
    });
  });
  it("gives the reason without a price", () => {
    expect(explainCpaCounted("$200 CPA", null, "CPA not in euros").working).toBe(
      "“$200 CPA”: CPA not in euros, so its first deposits earn nothing",
    );
    expect(explainCpaCounted("", null, null).working).toBe(
      "No deal text: No price, so its first deposits earn nothing",
    );
  });
});

describe("explainGood / explainUnresolved", () => {
  it("good is total minus bad", () => {
    expect(explainGood(1_000, 25)).toEqual({
      formula: LOCAL_FORMULAS.good,
      working: "1,000 total − 25 bad = 975",
    });
  });
  it("unresolved subtracts every resolved count", () => {
    expect(
      explainUnresolved({ total: 100, bad: 5, hlr: 10, mnp: 0, localOnly: 2, checking: 1 }).working,
    ).toBe("100 total − 5 bad − 10 HLR − 0 MNP − 2 local only − 1 checking = 82");
  });
});

describe("explainNet", () => {
  it("adds the day's entries with their signs", () => {
    expect(
      explainNet({
        depositsMicro: 100_000_000n,
        debitsMicro: -12_340_000n,
        refundsMicro: 1_000_000n,
        adjustmentsMicro: 0n,
        netMicro: 88_660_000n,
      }),
    ).toEqual({
      formula: LOCAL_FORMULAS.net,
      working: "€100.00 deposits − €12.34 debits + €1.00 refunds = €88.66",
    });
  });
  it("leads with a minus when there are no deposits", () => {
    expect(
      explainNet({
        depositsMicro: 0n,
        debitsMicro: -3_000_000n,
        refundsMicro: 0n,
        adjustmentsMicro: -1_000_000n,
        netMicro: -4_000_000n,
      }).working,
    ).toBe("-€3.00 debits − €1.00 adjustments = -€4.00");
  });
  it("notes when the rounded parts do not add up to the rounded net", () => {
    const e = explainNet({
      depositsMicro: 0n,
      debitsMicro: -4_000n,
      refundsMicro: 0n,
      adjustmentsMicro: -4_000n,
      netMicro: -8_000n,
    });
    expect(e.working).toBe("-€0.00 debits − €0.00 adjustments = -€0.01");
    expect(e.note).toMatch(/rounded/);
  });
  it("has nothing to add on an empty day", () => {
    expect(
      explainNet({
        depositsMicro: 0n,
        debitsMicro: 0n,
        refundsMicro: 0n,
        adjustmentsMicro: 0n,
        netMicro: 0n,
      }).working,
    ).toBe("Nothing yet = €0.00");
  });
});

describe("explainCampaignSpend", () => {
  it("is debits less refunds", () => {
    expect(
      explainCampaignSpend({
        debitsMicro: -12_000_000n,
        refundsMicro: 1_000_000n,
        netMicro: -11_000_000n,
      }),
    ).toEqual({
      formula: LOCAL_FORMULAS.campaignSpend,
      working: "€12.00 debits − €1.00 refunds = €11.00",
    });
  });
  it("shows other entries on the campaign's SMS", () => {
    expect(
      explainCampaignSpend({ debitsMicro: -12_000_000n, refundsMicro: 0n, netMicro: -12_500_000n })
        .working,
    ).toBe("€12.00 debits + €0.50 other entries = €12.50");
  });
});

describe("explainBalance", () => {
  it("adds the carriers' balances", () => {
    expect(
      explainBalance({
        source: "carrier",
        carriers: [
          { label: "23Telecom", shown: "€100.00" },
          { label: "Other", shown: "€5.50" },
        ],
        shown: "€105.50",
      }),
    ).toEqual({
      formula: FORMULAS.balance,
      working: "23Telecom €100.00 + Other €5.50 = €105.50",
    });
  });
  it("falls back to the ledger", () => {
    const e = explainBalance({ source: "ledger", carriers: [], shown: "€40.00" });
    expect(e.formula).toBe(LOCAL_FORMULAS.ledgerBalance);
    expect(e.working).toBe("Sum of every ledger entry = €40.00");
  });
});

describe("explainEstimate", () => {
  it("prices every combination on every route", () => {
    expect(
      explainEstimate({
        combos: 2,
        priceMicros: [45_000, null],
        cascade: false,
        tests: 4,
        shown: "€0.09",
      }),
    ).toEqual({
      formula: LOCAL_FORMULAS.testEstimate,
      working: "2 combinations × (€0.0450 + €0.0000 no price) = €0.09",
      note: LOCAL_FORMULAS.testEstimateNote,
    });
  });
  it("prices a cascade at the dearest route", () => {
    expect(
      explainEstimate({
        combos: 3,
        priceMicros: [45_000, 30_000],
        cascade: true,
        tests: 3,
        shown: "€0.14",
      }).working,
    ).toBe("3 combinations × €0.0450 dearest route = €0.14");
  });
  it("explains an empty estimate", () => {
    expect(
      explainEstimate({ combos: 2, priceMicros: [], cascade: false, tests: 0, shown: "-" }).working,
    ).toBe("No route, sender or text chosen yet, so no estimate");
  });
});

describe("explainTotal", () => {
  it("adds the rows above", () => {
    expect(explainTotal(["€1.00", "€2.50"], "€3.50", "days")).toBe("€1.00 + €2.50 = €3.50");
    expect(explainTotal([], "€0.00", "days")).toBe("Nothing yet = €0.00");
    const many = Array.from({ length: 9 }, () => "€1.00");
    expect(explainTotal(many, "€9.00", "days")).toBe("9 days added up = €9.00");
  });
});
