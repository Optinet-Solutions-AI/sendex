import { describe, expect, it } from "vitest";
import { FORMULAS, workingDivide, workingMinus, workingPerSale, workingSum } from "./formulas.js";

describe("FORMULAS (D5-20)", () => {
  it("writes each figure's formula in plain words", () => {
    expect(FORMULAS.ctr).toBe("CTR = Clicks ÷ Sent");
    expect(FORMULAS.cps).toBe("CPS = Cost ÷ Sales (first deposits)");
    expect(FORMULAS.roi).toBe("ROI = (Revenue − Cost) ÷ Cost");
    expect(FORMULAS.revenue).toBe(
      "Revenue = each first deposit × its offer's deal CPA on the deposit day",
    );
    for (const text of Object.values(FORMULAS)) expect(text).toMatch(/ = /);
  });
});

describe("workings", () => {
  it("divides with the numbers as shown on the screen", () => {
    expect(workingDivide("9 clicks", "190 sent", "4.74%")).toBe("9 clicks ÷ 190 sent = 4.74%");
  });

  it("says why there is no figure when the divisor is zero", () => {
    expect(
      workingDivide("0 clicks", "0 sent", "—", { emptyWhen: true, empty: "No SMS sent yet" }),
    ).toBe("No SMS sent yet");
  });

  it("subtracts and adds", () => {
    expect(workingMinus("€16,720.00 revenue", "€40.00 cost", "€16,680.00")).toBe(
      "€16,720.00 revenue − €40.00 cost = €16,680.00",
    );
    expect(workingSum(["€38.40", "€9.60"], "€48.00")).toBe("€38.40 + €9.60 = €48.00");
    expect(workingSum([], "€0.00")).toBe("Nothing yet = €0.00");
  });

  it("explains revenue from first deposits and the average CPA", () => {
    expect(workingPerSale(36, "€8,640.00", "€240.00")).toBe(
      "36 first deposits, on average €240.00 each = €8,640.00",
    );
    expect(workingPerSale(1, "€250.00", "€250.00")).toBe("1 first deposit at €250.00 = €250.00");
    expect(workingPerSale(0, "€0.00", "—")).toBe("No first deposits yet");
  });
});
