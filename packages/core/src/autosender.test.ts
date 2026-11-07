import { describe, expect, it } from "vitest";
import { AUTOSENDER_DEFAULTS, type AutosenderLap, autosenderDecision } from "./autosender.js";

const T0 = new Date("2026-11-07T09:00:00Z");
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

const settings = { testSize: 100, ...AUTOSENDER_DEFAULTS };

function lap(over: Partial<AutosenderLap> & { id: string; routeId: string }): AutosenderLap {
  return {
    listId: "L1",
    status: "done",
    scale: false,
    sent: 100,
    clicks: 0,
    costMicro: 2_500_000,
    startedAt: T0,
    finishedAt: at(5),
    ...over,
  };
}

const testRound = [
  lap({ id: "t405", routeId: "R405", clicks: 5 }),
  lap({ id: "t403", routeId: "R403", clicks: 2 }),
];

describe("autosenderDecision", () => {
  it("waits while a test lap is still sending", () => {
    const d = autosenderDecision({
      now: at(120),
      settings,
      laps: [
        testRound[0] as AutosenderLap,
        lap({ id: "t403", routeId: "R403", status: "sending" }),
      ],
      available: [{ listId: "L1", available: 1_000 }],
    });
    expect(d).toEqual({ action: "wait", reason: "test round still sending" });
  });

  it("waits until 60 minutes after the test round started, even when every lap is done", () => {
    const d = autosenderDecision({
      now: at(30),
      settings,
      laps: testRound,
      available: [{ listId: "L1", available: 1_000 }],
    });
    expect(d.action).toBe("wait");
    expect(d.action === "wait" && d.reason).toContain("measuring until 2026-11-07T10:00:00");
  });

  it("scales out the best route by CTR in laps of five times the test size, capped by what is left", () => {
    const d = autosenderDecision({
      now: at(60),
      settings,
      laps: testRound,
      available: [
        { listId: "L1", available: 1_000 },
        { listId: "L2", available: 120 },
        { listId: "L3", available: 0 },
      ],
    });
    expect(d).toEqual({
      action: "scale",
      routeId: "R405",
      laps: [
        { listId: "L1", count: 500 },
        { listId: "L2", count: 120 },
      ],
      testCtr: 0.05,
    });
  });

  it("stops when the test round got no clicks", () => {
    const d = autosenderDecision({
      now: at(60),
      settings,
      laps: [lap({ id: "t405", routeId: "R405" }), lap({ id: "t403", routeId: "R403" })],
      available: [{ listId: "L1", available: 1_000 }],
    });
    expect(d).toEqual({ action: "stop", reason: "no clicks in the test round" });
  });

  it("waits while a scale-out lap is sending, then scales again while the CTR holds", () => {
    const sending = lap({ id: "s1", routeId: "R405", scale: true, status: "sending", sent: 200 });
    expect(
      autosenderDecision({
        now: at(90),
        settings,
        laps: [...testRound, sending],
        available: [{ listId: "L1", available: 500 }],
      }),
    ).toEqual({ action: "wait", reason: "scale-out lap still sending" });

    const held = lap({
      id: "s1",
      routeId: "R405",
      scale: true,
      sent: 500,
      clicks: 21,
      startedAt: at(61),
      finishedAt: at(80),
    });
    expect(
      autosenderDecision({
        now: at(90),
        settings,
        laps: [...testRound, held],
        available: [{ listId: "L1", available: 300 }],
      }),
    ).toEqual({
      action: "scale",
      routeId: "R405",
      laps: [{ listId: "L1", count: 300 }],
      testCtr: 0.05,
    });
  });

  it("stops when the last scale-out lap's CTR falls below 80% of the test CTR", () => {
    const dropped = lap({
      id: "s1",
      routeId: "R405",
      scale: true,
      sent: 500,
      clicks: 15,
      startedAt: at(61),
      finishedAt: at(80),
    });
    const d = autosenderDecision({
      now: at(90),
      settings,
      laps: [...testRound, dropped],
      available: [{ listId: "L1", available: 300 }],
    });
    expect(d).toEqual({
      action: "stop",
      reason: "CTR dropped to 3.00%, below 80% of the test CTR 5.00%",
    });
  });

  it("stops once the lists are finished", () => {
    const d = autosenderDecision({
      now: at(60),
      settings,
      laps: testRound,
      available: [{ listId: "L1", available: 0 }],
    });
    expect(d).toEqual({ action: "stop", reason: "lists finished" });
  });

  it("ignores cancelled laps and stops with nothing to measure", () => {
    const d = autosenderDecision({
      now: at(60),
      settings,
      laps: [lap({ id: "t405", routeId: "R405", status: "cancelled" })],
      available: [{ listId: "L1", available: 10 }],
    });
    expect(d).toEqual({ action: "stop", reason: "no test laps to measure" });
  });

  it("rejects bad settings", () => {
    expect(() =>
      autosenderDecision({
        now: T0,
        settings: { ...settings, scaleFactor: 0 },
        laps: testRound,
        available: [],
      }),
    ).toThrow(RangeError);
  });
});
