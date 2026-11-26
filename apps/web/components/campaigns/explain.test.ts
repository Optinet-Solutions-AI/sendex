import { FORMULAS } from "@sendex/core";
import { describe, expect, it } from "vitest";
import {
  explainCostOfLaps,
  explainCostPer,
  explainCountries,
  explainDaySent,
  explainEstimate,
  explainLapCost,
  explainParts,
  explainProgress,
  explainRank,
  explainRate,
  explainRevenue,
  explainSmsPlanned,
  LOCAL_FORMULAS,
} from "./explain";

describe("explainRate (D5-20)", () => {
  it("divides the counts as shown and ends on the displayed percentage", () => {
    expect(explainRate("ctr", 9, 190, 9 / 190)).toEqual({
      formula: FORMULAS.ctr,
      working: "9 clicks ÷ 190 sent = 4.74%",
    });
    expect(explainRate("deliveryRate", 1200, 1500, 0.8).working).toBe(
      "1,200 delivered ÷ 1,500 sent = 80.00%",
    );
    expect(explainRate("leadRate", 1, 40, 1 / 40).working).toBe("1 lead ÷ 40 sent = 2.50%");
    expect(explainRate("saleRate", 2, 3, 2 / 3).working).toBe("2 sales ÷ 3 sent = 66.67%");
  });

  it("says why when nothing was sent", () => {
    expect(explainRate("ctr", 0, 0, 0).working).toBe("No SMS sent yet, so 0.00%");
  });

  it("takes another formula wording when the screen counts differently", () => {
    expect(explainRate("ctr", 3, 10, 0.3, LOCAL_FORMULAS.ctrRedirects).formula).toBe(
      LOCAL_FORMULAS.ctrRedirects,
    );
  });
});

describe("explainCostPer", () => {
  it("divides the cost by the count, rounded to the cent shown", () => {
    expect(explainCostPer("cpc", 1_900_000, 9, 211_111)).toEqual({
      formula: FORMULAS.cpc,
      working: "€1.90 cost ÷ 9 clicks = €0.21",
    });
    expect(explainCostPer("cps", 5_000_000, 1, 5_000_000).working).toBe(
      "€5.00 cost ÷ 1 sale = €5.00",
    );
    expect(explainCostPer("cpl", 100_000, 3, 33_333).working).toBe("€0.10 cost ÷ 3 leads = €0.03");
  });

  it("explains the dash without any", () => {
    expect(explainCostPer("cpl", 4_000_000, 0, null).working).toBe("No leads yet, so –");
  });
});

describe("explainCostOfLaps", () => {
  it("adds the laps' costs", () => {
    const e = explainCostOfLaps([1_500_000, 2_250_000], 3_750_000);
    expect(e.formula).toBe(LOCAL_FORMULAS.campaignCost);
    expect(e.working).toBe("€1.50 + €2.25 = €3.75");
  });

  it("names how many laps when there are many or only a count", () => {
    expect(explainCostOfLaps([1, 2, 3, 4, 5, 6, 7], 28).working).toBe("7 laps added up = €0.00");
    expect(explainCostOfLaps(3, 9_000_000).working).toBe("3 laps added up = €9.00");
  });

  it("says nothing was sent without laps", () => {
    expect(explainCostOfLaps([], 0).working).toBe("Nothing yet = €0.00");
    expect(explainCostOfLaps(0, 0).working).toBe("Nothing yet = €0.00");
  });
});

describe("explainLapCost", () => {
  it("multiplies out when the lap cost is exactly sent × parts × price", () => {
    expect(
      explainLapCost({ sent: 190, parts: 1, priceMicro: 30_000, costMicro: 5_700_000 }),
    ).toEqual({
      formula: LOCAL_FORMULAS.lapCost,
      working: "190 sent × 1 part × €0.0300 = €5.70",
    });
    expect(
      explainLapCost({ sent: 3, parts: 2, priceMicro: 25_000, costMicro: 150_000 }).working,
    ).toBe("3 sent × 2 parts × €0.0250 = €0.15");
  });

  it("says the bill differs from today's price when it does not multiply out", () => {
    const e = explainLapCost({ sent: 190, parts: 1, priceMicro: 30_000, costMicro: 5_820_000 });
    expect(e.working).toBe("190 sent, each billed its parts × the price when sent = €5.82");
    expect(e.note).toBe(
      "Today's price is €0.0300 per part; longer texts, a route fee or a price change make the total differ.",
    );
  });

  it("explains a lap that sent nothing", () => {
    expect(explainLapCost({ sent: 0, parts: 1, priceMicro: null, costMicro: 0 }).working).toBe(
      "No SMS sent yet = €0.00",
    );
  });
});

describe("explainProgress", () => {
  it("divides sent by the laps' planned sizes, rounded to a whole percent", () => {
    expect(explainProgress({ sent: 1, planned: 3, contacts: 500, progress: 33 })).toEqual({
      formula: LOCAL_FORMULAS.progress,
      working: "1 sent ÷ 3 planned in the laps = 33%",
    });
  });

  it("uses the contacts before any lap and caps at 100%", () => {
    expect(explainProgress({ sent: 0, planned: 0, contacts: 400, progress: 0 }).working).toBe(
      "0 sent ÷ 400 contacts available = 0%",
    );
    expect(explainProgress({ sent: 120, planned: 100, contacts: 0, progress: 100 }).working).toBe(
      "120 sent ÷ 100 planned in the laps = 120%, shown as 100%",
    );
  });

  it("says why without a target", () => {
    expect(explainProgress({ sent: 0, planned: 0, contacts: 0, progress: 0 }).working).toBe(
      "Nothing planned and no contacts available, so 0%",
    );
  });
});

describe("explainRank", () => {
  it("places the lap among the ranked laps", () => {
    expect(explainRank(2, 5)).toEqual({
      formula: LOCAL_FORMULAS.rank,
      working: "Rank 2 of 5 finished laps",
      note: "Set each time a lap finishes; clicks that come later move it at the next finish.",
    });
  });

  it("says why there is no rank", () => {
    expect(explainRank(null, 5).working).toBe("No rank yet: a lap is ranked once it finishes");
  });
});

describe("explainRevenue", () => {
  it("averages the CPA over the first deposits", () => {
    expect(explainRevenue(36, 8_640_000_000)).toEqual({
      formula: FORMULAS.revenue,
      working: "36 first deposits, on average €240.00 each = €8,640.00",
    });
    expect(explainRevenue(1, 250_000_000).working).toBe("1 first deposit at €250.00 = €250.00");
  });

  it("rounds the average to the cent", () => {
    expect(explainRevenue(3, 100_000_000).working).toBe(
      "3 first deposits, on average €33.33 each = €100.00",
    );
  });

  it("says none yet, and why deposits earned nothing", () => {
    expect(explainRevenue(0, 0).working).toBe("No first deposits yet");
    expect(explainRevenue(2, 0).note).toBe(
      "A deposit earns nothing when its offer has no brand deal priced for that day.",
    );
  });
});

describe("explainSmsPlanned and explainEstimate", () => {
  const laps = [
    { count: 100, costMicro: 3_000_000 },
    { count: 100, costMicro: 2_500_000 },
  ];

  it("adds up the planned laps", () => {
    expect(explainSmsPlanned(laps, 200)).toEqual({
      formula: LOCAL_FORMULAS.smsPlanned,
      working: "100 + 100 = 200",
    });
    expect(explainSmsPlanned([], 0).working).toBe("Nothing planned yet = 0");
  });

  it("multiplies each lap out at its route price and parts", () => {
    expect(explainEstimate(laps, 1, 5_500_000)).toEqual({
      formula: FORMULAS.estimate,
      working: "100 × €0.0300 × 1 part + 100 × €0.0250 × 1 part = ~€5.50",
    });
    expect(explainEstimate([{ count: 3, costMicro: 150_000 }], 2, 150_000).working).toBe(
      "3 × €0.0250 × 2 parts = ~€0.15",
    );
  });

  it("falls back to the lap costs when the price is not a whole micro", () => {
    expect(explainEstimate([{ count: 3, costMicro: 100_000 }], 1, 100_000).working).toBe(
      "€0.10 = ~€0.10",
    );
  });

  it("summarises many laps and nothing planned", () => {
    const many = Array.from({ length: 6 }, () => ({ count: 10, costMicro: 300_000 }));
    expect(explainEstimate(many, 1, 1_800_000).working).toBe(
      "6 laps of SMS × price × parts added up = ~€1.80",
    );
    expect(explainEstimate([], 1, 0).working).toBe("Nothing planned yet = ~€0.00");
  });
});

describe("explainParts", () => {
  it("fits one part up to the single-SMS limit", () => {
    expect(explainParts({ encoding: "GSM_7BIT", chars: 120, parts: 1, left: 40 })).toEqual({
      formula: LOCAL_FORMULAS.parts,
      working: "120 chars ≤ 160, so 1 part; 160 − 120 = 40 left",
    });
  });

  it("says how the link and the word choices were counted", () => {
    expect(explainParts({ encoding: "GSM_7BIT", chars: 120, parts: 1, left: 40 }, 21).note).toBe(
      "{{domain}} counts as the 21-character short link; {a|b} as its longest word.",
    );
  });

  it("rounds the parts up over the multipart size", () => {
    expect(explainParts({ encoding: "GSM_7BIT", chars: 200, parts: 2, left: 106 }).working).toBe(
      "200 chars ÷ 153 per part, rounded up = 2 parts; 2 × 153 − 200 = 106 left",
    );
    expect(explainParts({ encoding: "UCS2", chars: 71, parts: 2, left: 63 }).working).toBe(
      "71 chars ÷ 67 per part, rounded up = 2 parts; 2 × 67 − 71 = 63 left",
    );
  });
});

describe("calendar explanations", () => {
  it("adds the day's countries and scales the bar to the busiest day", () => {
    expect(explainDaySent([2_000, 500], 2_500, 3_000, 83)).toEqual({
      formula: LOCAL_FORMULAS.daySent,
      working: "2,000 + 500 = 2,500",
      note: "Bar: 2,500 ÷ 3,000 on the busiest day = 83%",
    });
  });

  it("says when the bar is drawn wider than its share", () => {
    expect(explainDaySent([10], 10, 1_000, 4).note).toBe(
      "Bar: 10 ÷ 1,000 on the busiest day = 1%, drawn at least 4% wide",
    );
  });

  it("lists the countries counted", () => {
    expect(explainCountries(["Poland", "Spain"], 2)).toEqual({
      formula: LOCAL_FORMULAS.countries,
      working: "Poland, Spain = 2",
    });
    expect(explainCountries([], 0).working).toBe("No sends in this period = 0");
    expect(explainCountries(["A", "B", "C", "D", "E", "F", "G"], 7).working).toBe(
      "A, B, C, D, E and 2 more = 7",
    );
  });
});
