import { describe, expect, it } from "vitest";
import { budgetPlan, finishListPlan, planLaps, rankLaps, topUpPlan, topUpTooltip } from "./laps.js";

const route = (routeId: string, priceMicro = 25_000) => ({ routeId, priceMicro });

describe("planLaps", () => {
  it("makes one lap per list and route: 100 × 1 × 5 = 500", () => {
    const laps = planLaps({
      testSize: 100,
      lists: [{ listId: "L1", available: 10_000 }],
      routes: [route("R1"), route("R2"), route("R3"), route("R4"), route("R5")],
    });
    expect(laps).toHaveLength(5);
    expect(laps.reduce((sum, lap) => sum + lap.count, 0)).toBe(500);
    expect(laps[0]).toEqual({ listId: "L1", routeId: "R1", count: 100, costMicro: 2_500_000 });
  });

  it("prices every SMS part: two-part messages cost twice as much", () => {
    const [lap] = planLaps({
      testSize: 100,
      lists: [{ listId: "L1", available: 10_000 }],
      routes: [route("R1")],
      partsPerMessage: 2,
    });
    expect(lap).toEqual({ listId: "L1", routeId: "R1", count: 100, costMicro: 5_000_000 });
  });

  it("caps the lap at what the list has left: 50 left with test size 200 yields 50", () => {
    const laps = planLaps({
      testSize: 200,
      lists: [{ listId: "L1", available: 50 }],
      routes: [route("R1")],
    });
    expect(laps).toEqual([{ listId: "L1", routeId: "R1", count: 50, costMicro: 1_250_000 }]);
  });

  it("orders laps list by list, then route by route", () => {
    const laps = planLaps({
      testSize: 10,
      lists: [
        { listId: "L1", available: 100 },
        { listId: "L2", available: 100 },
      ],
      routes: [route("R1"), route("R2")],
    });
    expect(laps.map((l) => `${l.listId}/${l.routeId}`)).toEqual([
      "L1/R1",
      "L1/R2",
      "L2/R1",
      "L2/R2",
    ]);
  });

  it("omits laps with nothing to send", () => {
    const laps = planLaps({
      testSize: 100,
      lists: [
        { listId: "L1", available: 0 },
        { listId: "L2", available: 5 },
      ],
      routes: [route("R1")],
    });
    expect(laps).toEqual([{ listId: "L2", routeId: "R1", count: 5, costMicro: 125_000 }]);
  });

  it("uses each route's own price", () => {
    const laps = planLaps({
      testSize: 200,
      lists: [{ listId: "L1", available: 1_000 }],
      routes: [route("R1", 25_000), route("R2", 27_000)],
    });
    expect(laps.map((l) => l.costMicro)).toEqual([5_000_000, 5_400_000]);
  });

  it("send-all splits the list evenly across routes, remainder to the first routes", () => {
    const laps = planLaps({
      testSize: 100,
      sendAll: true,
      lists: [{ listId: "L1", available: 1_000 }],
      routes: [route("R1"), route("R2"), route("R3")],
    });
    expect(laps.map((l) => l.count)).toEqual([334, 333, 333]);
    expect(laps.reduce((sum, lap) => sum + lap.count, 0)).toBe(1_000);
  });

  it("send-all with more routes than contacts omits the empty laps", () => {
    const laps = planLaps({
      testSize: 100,
      sendAll: true,
      lists: [{ listId: "L1", available: 2 }],
      routes: [route("R1"), route("R2"), route("R3")],
    });
    expect(laps.map((l) => `${l.routeId}:${l.count}`)).toEqual(["R1:1", "R2:1"]);
  });

  it("returns nothing when there are no routes or no lists", () => {
    expect(planLaps({ testSize: 100, lists: [], routes: [route("R1")] })).toEqual([]);
    expect(
      planLaps({ testSize: 100, lists: [{ listId: "L1", available: 10 }], routes: [] }),
    ).toEqual([]);
  });

  it("rejects negative or fractional inputs", () => {
    expect(() =>
      planLaps({ testSize: -1, lists: [{ listId: "L1", available: 10 }], routes: [route("R1")] }),
    ).toThrow(RangeError);
    expect(() =>
      planLaps({ testSize: 10, lists: [{ listId: "L1", available: 1.5 }], routes: [route("R1")] }),
    ).toThrow(RangeError);
    expect(() =>
      planLaps({
        testSize: 10,
        lists: [{ listId: "L1", available: 10 }],
        routes: [route("R1", -1)],
      }),
    ).toThrow(RangeError);
  });
});

describe("finishListPlan", () => {
  it("sends everything that is left on one route", () => {
    expect(finishListPlan({ available: 750, routeId: "R2", priceMicro: 27_000 })).toEqual({
      routeId: "R2",
      count: 750,
      costMicro: 20_250_000,
    });
  });

  it("is a zero lap when the list is exhausted", () => {
    expect(finishListPlan({ available: 0, routeId: "R1", priceMicro: 25_000 })).toEqual({
      routeId: "R1",
      count: 0,
      costMicro: 0,
    });
  });
});

describe("budgetPlan", () => {
  it("EUR 10 at 0.025 buys 400 messages", () => {
    expect(budgetPlan({ budgetMicro: 10_000_000, priceMicro: 25_000 })).toBe(400);
  });

  it("rounds down for the SMS Edge quick-amount buttons", () => {
    // 0.027 per SMS
    expect(budgetPlan({ budgetMicro: 5_000_000, priceMicro: 27_000 })).toBe(185);
    expect(budgetPlan({ budgetMicro: 20_000_000, priceMicro: 27_000 })).toBe(740);
    expect(budgetPlan({ budgetMicro: 50_000_000, priceMicro: 27_000 })).toBe(1_851);
    expect(budgetPlan({ budgetMicro: 100_000_000, priceMicro: 27_000 })).toBe(3_703);
    expect(budgetPlan({ budgetMicro: 200_000_000, priceMicro: 27_000 })).toBe(7_407);
  });

  it("is zero when the budget does not cover one message", () => {
    expect(budgetPlan({ budgetMicro: 10_000, priceMicro: 25_000 })).toBe(0);
    expect(budgetPlan({ budgetMicro: 0, priceMicro: 25_000 })).toBe(0);
  });

  it("rejects a non-positive price and a negative budget", () => {
    expect(() => budgetPlan({ budgetMicro: 10_000_000, priceMicro: 0 })).toThrow(RangeError);
    expect(() => budgetPlan({ budgetMicro: -1, priceMicro: 25_000 })).toThrow(RangeError);
  });
});

describe("rankLaps", () => {
  const lap = (id: string, sent: number, clicks: number, costMicro = sent * 25_000) => ({
    id,
    sent,
    clicks,
    costMicro,
    leads: 0,
    sales: 0,
  });

  it("matches the recording: 2,394/127 above 497/25 above 98/3", () => {
    const ranked = rankLaps([lap("c", 98, 3), lap("a", 2_394, 127), lap("b", 497, 25)]);
    expect(ranked.map((r) => [r.id, r.rank])).toEqual([
      ["a", 1],
      ["b", 2],
      ["c", 3],
    ]);
    expect(ranked[0]?.ctr).toBeCloseTo(127 / 2_394, 10);
    expect(ranked[0]?.cpcMicro).toBe(Math.round((2_394 * 25_000) / 127));
  });

  it("breaks a CTR tie by cheaper cost per click, then by more sent", () => {
    const ranked = rankLaps([
      lap("small", 100, 10, 3_000_000),
      lap("cheap", 100, 10, 2_000_000),
      lap("big", 200, 20, 6_000_000),
    ]);
    // cheap: CPC 200k; small and big: CPC 300k, big has more sent
    expect(ranked.map((r) => r.id)).toEqual(["cheap", "big", "small"]);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it("puts laps with nothing sent last with a CTR of 0 and no CPC", () => {
    const ranked = rankLaps([lap("empty", 0, 0, 0), lap("live", 50, 1)]);
    expect(ranked.map((r) => r.id)).toEqual(["live", "empty"]);
    expect(ranked[1]).toEqual({ id: "empty", rank: 2, ctr: 0, cpcMicro: null });
  });

  it("has no CPC when a lap was sent but got no clicks", () => {
    const ranked = rankLaps([lap("none", 100, 0)]);
    expect(ranked[0]).toEqual({ id: "none", rank: 1, ctr: 0, cpcMicro: null });
  });

  it("returns an empty ranking for no laps", () => {
    expect(rankLaps([])).toEqual([]);
  });
});

describe("topUpPlan", () => {
  it("adds the amount to every active lap and counts the new SMS at each lap's price", () => {
    const plan = topUpPlan({
      amountMicro: 50_000_000,
      laps: [
        { id: "a", active: true, priceMicro: 25_000 },
        { id: "b", active: true, priceMicro: 25_000 },
        { id: "c", active: true, priceMicro: 25_000 },
        { id: "d", active: false, priceMicro: 25_000 },
        { id: "e", active: true, priceMicro: null },
      ],
    });
    expect(plan.activeLaps).toBe(3);
    expect(plan.totalMicro).toBe(150_000_000);
    expect(plan.newSms).toBe(6_000);
    expect(plan.laps).toEqual([
      { id: "a", extra: 2_000 },
      { id: "b", extra: 2_000 },
      { id: "c", extra: 2_000 },
    ]);
  });

  it("buys half as many two-part messages, so the lap does not spend more than the amount", () => {
    const plan = topUpPlan({
      amountMicro: 10_000_000,
      laps: [{ id: "a", active: true, priceMicro: 25_000 }],
      partsPerMessage: 2,
    });
    expect(plan.laps).toEqual([{ id: "a", extra: 200 }]);
    expect(plan.newSms).toBe(200);
    expect(plan.totalMicro).toBe(10_000_000);
  });

  it("spells the tooltip out: 3 active sends × €50 = €150 · New SMS sent: ~6,000", () => {
    const plan = topUpPlan({
      amountMicro: 50_000_000,
      laps: [
        { id: "a", active: true, priceMicro: 25_000 },
        { id: "b", active: true, priceMicro: 25_000 },
        { id: "c", active: true, priceMicro: 25_000 },
      ],
    });
    expect(topUpTooltip(plan, 50_000_000)).toBe(
      "3 active sends × €50 = €150 · New SMS sent: ~6,000 · Will spend an additional €50 per each highlighted lap",
    );
  });

  it("with no active lap the tooltip says so", () => {
    const plan = topUpPlan({ amountMicro: 5_000_000, laps: [] });
    expect(plan.activeLaps).toBe(0);
    expect(topUpTooltip(plan, 5_000_000)).toBe("No active lap to top up");
  });

  it("rejects a non-positive amount", () => {
    expect(() => topUpPlan({ amountMicro: 0, laps: [] })).toThrow(RangeError);
  });
});
