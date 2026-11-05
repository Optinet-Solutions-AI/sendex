function assertNonNegativeInt(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer, got ${value}`);
  }
}

export interface LapList {
  listId: string;
  /** Contacts not yet sent to and not suppressed. */
  available: number;
}

export interface LapRoute {
  routeId: string;
  /** Price per SMS in micro-euros. */
  priceMicro: number;
}

export interface PlanLapsInput {
  testSize: number;
  lists: readonly LapList[];
  routes: readonly LapRoute[];
  /** Send every available contact, split evenly across the routes, instead of a test slice. */
  sendAll?: boolean;
}

export interface PlannedLap {
  listId: string;
  routeId: string;
  count: number;
  costMicro: number;
}

/**
 * One lap per (list, route). Each lap sends `min(testSize, available)` from its list, or with
 * `sendAll` the list's available contacts are split evenly across its routes with the remainder
 * going to the first routes. Laps that would send nothing are omitted.
 */
export function planLaps(input: PlanLapsInput): PlannedLap[] {
  assertNonNegativeInt("testSize", input.testSize);
  for (const r of input.routes) {
    assertNonNegativeInt("priceMicro", r.priceMicro);
  }

  const laps: PlannedLap[] = [];
  const routeCount = input.routes.length;

  for (const list of input.lists) {
    assertNonNegativeInt("available", list.available);
    if (routeCount === 0) {
      continue;
    }
    const share = Math.floor(list.available / routeCount);
    const remainder = list.available % routeCount;

    for (let i = 0; i < routeCount; i += 1) {
      const route = input.routes[i];
      if (route === undefined) {
        continue;
      }
      const count =
        input.sendAll === true
          ? share + (i < remainder ? 1 : 0)
          : Math.min(input.testSize, list.available);
      if (count === 0) {
        continue;
      }
      laps.push({
        listId: list.listId,
        routeId: route.routeId,
        count,
        costMicro: count * route.priceMicro,
      });
    }
  }

  return laps;
}

export interface FinishListInput {
  available: number;
  routeId: string;
  priceMicro: number;
}

export interface FinishLap {
  routeId: string;
  count: number;
  costMicro: number;
}

/** The lap that sends everything left on a list through one route ("finish list"). */
export function finishListPlan(input: FinishListInput): FinishLap {
  assertNonNegativeInt("available", input.available);
  assertNonNegativeInt("priceMicro", input.priceMicro);
  return {
    routeId: input.routeId,
    count: input.available,
    costMicro: input.available * input.priceMicro,
  };
}

export interface BudgetPlanInput {
  budgetMicro: number;
  priceMicro: number;
}

/** How many messages a budget buys at a price, rounded down (the EUR 5/10/20/… buttons). */
export function budgetPlan(input: BudgetPlanInput): number {
  assertNonNegativeInt("budgetMicro", input.budgetMicro);
  assertNonNegativeInt("priceMicro", input.priceMicro);
  if (input.priceMicro === 0) {
    throw new RangeError("priceMicro must be positive");
  }
  return Math.floor(input.budgetMicro / input.priceMicro);
}

export interface LapStats {
  id: string;
  sent: number;
  clicks: number;
  costMicro: number;
  leads: number;
  sales: number;
}

export interface RankedLap {
  id: string;
  rank: number;
  /** Clicks per message sent; 0 when nothing was sent. */
  ctr: number;
  /** Cost per click in micro-euros; null when there were no clicks. */
  cpcMicro: number | null;
}

/**
 * Rank laps by CTR descending, then cost per click ascending, then sent descending.
 * Laps with nothing sent rank last with a CTR of 0.
 */
export function rankLaps(laps: readonly LapStats[]): RankedLap[] {
  const scored = laps.map((lap) => {
    const ctr = lap.sent > 0 ? lap.clicks / lap.sent : 0;
    const cpcMicro = lap.clicks > 0 ? Math.round(lap.costMicro / lap.clicks) : null;
    return { id: lap.id, sent: lap.sent, ctr, cpcMicro };
  });

  scored.sort((a, b) => {
    if ((a.sent === 0) !== (b.sent === 0)) {
      return a.sent === 0 ? 1 : -1;
    }
    if (a.ctr !== b.ctr) {
      return b.ctr - a.ctr;
    }
    const aCpc = a.cpcMicro ?? Number.POSITIVE_INFINITY;
    const bCpc = b.cpcMicro ?? Number.POSITIVE_INFINITY;
    if (aCpc !== bCpc) {
      return aCpc - bCpc;
    }
    return b.sent - a.sent;
  });

  return scored.map((lap, index) => ({
    id: lap.id,
    rank: index + 1,
    ctr: lap.ctr,
    cpcMicro: lap.cpcMicro,
  }));
}
