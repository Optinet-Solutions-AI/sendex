import { describe, expect, it } from "vitest";
import { estimateCost, sendCount } from "./send-count.js";

describe("sendCount", () => {
  it("multiplies test size by lists by routes, as SMS Edge does", () => {
    expect(sendCount({ testSize: 100, lists: 1, routes: 5 })).toBe(500);
    expect(sendCount({ testSize: 200, lists: 1, routes: 1 })).toBe(200);
    expect(sendCount({ testSize: 200, lists: 2, routes: 3 })).toBe(1200);
  });
  it("is zero when any factor is zero", () => {
    expect(sendCount({ testSize: 100, lists: 0, routes: 5 })).toBe(0);
  });
  it("rejects negative or fractional inputs", () => {
    expect(() => sendCount({ testSize: -1, lists: 1, routes: 1 })).toThrow();
    expect(() => sendCount({ testSize: 1.5, lists: 1, routes: 1 })).toThrow();
  });
});

describe("estimateCost", () => {
  it("sums count times price per route, in integer micro-euros to avoid float drift", () => {
    // 200 messages on a 0.025 route and 200 on a 0.027 route
    expect(
      estimateCost([
        { count: 200, pricePerSms: 0.025 },
        { count: 200, pricePerSms: 0.027 },
      ]),
    ).toBeCloseTo(10.4, 6);
  });
  it("matches the recording: 200 SMS on route 405 at 0.025 is about 5.00", () => {
    expect(estimateCost([{ count: 200, pricePerSms: 0.025 }])).toBeCloseTo(5.0, 6);
  });
});
