import { describe, expect, it } from "vitest";
import { rankRoutes } from "./route-ranks.js";

describe("rankRoutes", () => {
  it("ranks by CTR, by cost per click and overall; unsent routes stay unranked", () => {
    const ranks = rankRoutes([
      { routeId: "405", sent: 600, clicks: 5, costMicro: 15_240_000 },
      { routeId: "403", sent: 400, clicks: 6, costMicro: 10_800_000 },
      { routeId: "136", sent: 100, clicks: 0, costMicro: 2_800_000 },
      { routeId: "423", sent: 0, clicks: 0, costMicro: 0 },
    ]);
    const by = new Map(ranks.map((r) => [r.routeId, r]));
    // CTR: 403 1.5% > 405 0.83% > 136 0%.
    expect(by.get("403")?.ctrRank).toBe(1);
    expect(by.get("405")?.ctrRank).toBe(2);
    expect(by.get("136")?.ctrRank).toBe(3);
    expect(by.get("423")?.ctrRank).toBeNull();
    // CPC: 403 €1.80 < 405 €3.05; no click on 136.
    expect(by.get("403")?.cpcRank).toBe(1);
    expect(by.get("405")?.cpcRank).toBe(2);
    expect(by.get("136")?.cpcRank).toBeNull();
    expect(by.get("405")?.cpcMicro).toBe(3_048_000);
    // Overall follows CTR, then CPC.
    expect(ranks.map((r) => [r.routeId, r.overallRank])).toEqual([
      ["405", 2],
      ["403", 1],
      ["136", 3],
      ["423", null],
    ]);
  });

  it("breaks a CTR tie by the cheaper click, then by volume (b and c tie on CPC)", () => {
    const ranks = rankRoutes([
      { routeId: "a", sent: 100, clicks: 1, costMicro: 3_000_000 },
      { routeId: "b", sent: 100, clicks: 1, costMicro: 2_000_000 },
      { routeId: "c", sent: 200, clicks: 2, costMicro: 4_000_000 },
    ]);
    expect(ranks.map((r) => [r.routeId, r.overallRank])).toEqual([
      ["a", 3],
      ["b", 2],
      ["c", 1],
    ]);
  });

  it("returns an empty list for no routes", () => {
    expect(rankRoutes([])).toEqual([]);
  });
});
