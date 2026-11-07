import { rankLaps } from "./laps.js";

/**
 * AutoSender: send a test batch per route, measure, then scale out the best route in laps
 * of `scaleFactor × testSize` while its CTR holds at `ctrFloorPercent` of the test value.
 * Pure: the worker feeds it the campaign's laps and what is left on its lists, and acts on
 * the decision. Every knob is a column on the campaign.
 */

export const AUTOSENDER_DEFAULTS = {
  /** Minutes to wait after the test round starts before judging it (clicks take a while). */
  measureMinutes: 60,
  /** Each scale-out lap sends this many times the test size. */
  scaleFactor: 5,
  /** Stop once a scale-out lap's CTR falls below this share of the test CTR. */
  ctrFloorPercent: 80,
} as const;

export interface AutosenderSettings {
  testSize: number;
  measureMinutes: number;
  scaleFactor: number;
  ctrFloorPercent: number;
}

export type AutosenderLapStatus = "queued" | "sending" | "done" | "cancelled";

export interface AutosenderLap {
  id: string;
  routeId: string;
  listId: string;
  status: AutosenderLapStatus;
  /** True for the laps AutoSender created when scaling out; false for the test round. */
  scale: boolean;
  sent: number;
  clicks: number;
  costMicro: number;
  startedAt: Date | null;
  finishedAt: Date | null;
}

export interface AutosenderInput {
  now: Date;
  settings: AutosenderSettings;
  laps: readonly AutosenderLap[];
  /** Contacts still eligible per list of the campaign. */
  available: ReadonlyArray<{ listId: string; available: number }>;
}

export type AutosenderDecision =
  | { action: "wait"; reason: string }
  | {
      action: "scale";
      routeId: string;
      laps: Array<{ listId: string; count: number }>;
      /** CTR of the winning test lap, the yardstick for the floor. */
      testCtr: number;
    }
  | { action: "stop"; reason: string };

function assertSettings(s: AutosenderSettings): void {
  if (!Number.isInteger(s.testSize) || s.testSize < 1) {
    throw new RangeError(`testSize must be a positive integer, got ${s.testSize}`);
  }
  if (!Number.isFinite(s.measureMinutes) || s.measureMinutes < 0) {
    throw new RangeError(`measureMinutes must be >= 0, got ${s.measureMinutes}`);
  }
  if (!Number.isInteger(s.scaleFactor) || s.scaleFactor < 1) {
    throw new RangeError(`scaleFactor must be a positive integer, got ${s.scaleFactor}`);
  }
  if (!Number.isFinite(s.ctrFloorPercent) || s.ctrFloorPercent < 0 || s.ctrFloorPercent > 100) {
    throw new RangeError(`ctrFloorPercent must be 0..100, got ${s.ctrFloorPercent}`);
  }
}

const running = (lap: AutosenderLap) => lap.status === "queued" || lap.status === "sending";
const ctrOf = (lap: AutosenderLap) => (lap.sent > 0 ? lap.clicks / lap.sent : 0);
const pct = (ratio: number) => `${(ratio * 100).toFixed(2)}%`;

/**
 * What AutoSender should do now. Test laps are the campaign's own send; the measure window
 * runs from the first test lap's start, and the round is judged once every test lap is done
 * and the window has passed, whichever is later. "Best" is `rankLaps` (highest CTR, lowest
 * CPC). Scale-out laps go one at a time; after each, the CTR is checked against the floor.
 */
export function autosenderDecision(input: AutosenderInput): AutosenderDecision {
  assertSettings(input.settings);
  const { settings, now } = input;
  const live = input.laps.filter((lap) => lap.status !== "cancelled");
  const testLaps = live.filter((lap) => !lap.scale);
  const scaleLaps = live.filter((lap) => lap.scale);

  if (testLaps.length === 0) return { action: "stop", reason: "no test laps to measure" };
  if (testLaps.some(running)) return { action: "wait", reason: "test round still sending" };

  const starts = testLaps.map((lap) => lap.startedAt?.getTime() ?? Number.POSITIVE_INFINITY);
  const firstStart = Math.min(...starts);
  const measureUntil = firstStart + settings.measureMinutes * 60_000;
  if (now.getTime() < measureUntil) {
    return {
      action: "wait",
      reason: `measuring until ${new Date(measureUntil).toISOString()}`,
    };
  }

  const ranked = rankLaps(
    testLaps.map((lap) => ({
      id: lap.id,
      sent: lap.sent,
      clicks: lap.clicks,
      costMicro: lap.costMicro,
      leads: 0,
      sales: 0,
    })),
  );
  const best = ranked[0];
  const bestLap = best ? testLaps.find((lap) => lap.id === best.id) : undefined;
  if (!best || !bestLap || best.ctr <= 0) {
    return { action: "stop", reason: "no clicks in the test round" };
  }

  if (scaleLaps.some(running)) return { action: "wait", reason: "scale-out lap still sending" };

  const finished = scaleLaps
    .filter((lap) => lap.status === "done" && lap.sent > 0)
    .sort((a, b) => (b.finishedAt?.getTime() ?? 0) - (a.finishedAt?.getTime() ?? 0));
  const last = finished[0];
  const floor = best.ctr * (settings.ctrFloorPercent / 100);
  if (last && ctrOf(last) < floor) {
    return {
      action: "stop",
      reason: `CTR dropped to ${pct(ctrOf(last))}, below ${settings.ctrFloorPercent}% of the test CTR ${pct(best.ctr)}`,
    };
  }

  const batch = settings.scaleFactor * settings.testSize;
  const laps = input.available
    .filter((l) => l.available > 0)
    .map((l) => ({ listId: l.listId, count: Math.min(batch, l.available) }));
  if (laps.length === 0) return { action: "stop", reason: "lists finished" };

  return { action: "scale", routeId: bestLap.routeId, laps, testCtr: best.ctr };
}
