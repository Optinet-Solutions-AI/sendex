function assertNonNegativeInt(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer, got ${value}`);
  }
}

export interface LapList {
  listId: string;
  /** Contacts not yet sent to and not suppressed. */
  available: number;
  /** When the lap draws only the list's contacts that match a segment. */
  segmentId?: string | null;
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
  /** SMS parts billed per message (`messageParts`). Default 1. */
  partsPerMessage?: number;
}

export interface PlannedLap {
  listId: string;
  routeId: string;
  count: number;
  costMicro: number;
  segmentId?: string | null;
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
  const parts = input.partsPerMessage ?? 1;
  assertNonNegativeInt("partsPerMessage", parts);

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
        costMicro: count * route.priceMicro * parts,
        ...(list.segmentId ? { segmentId: list.segmentId } : {}),
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

export interface TopUpLap {
  id: string;
  /** The lap's On switch: only active laps receive a top-up. */
  active: boolean;
  /** Price per SMS of the lap's route in micro-EUR; null when the route is unpriced. */
  priceMicro: number | null;
}

export interface TopUpPlanInput {
  amountMicro: number;
  laps: readonly TopUpLap[];
  /** SMS parts billed per message (`messageParts`). Default 1. */
  partsPerMessage?: number;
}

export interface TopUpPlan {
  /** The laps that receive the top-up and how many more messages each one buys. */
  laps: Array<{ id: string; extra: number }>;
  activeLaps: number;
  /** amount × active laps: what the top-up will cost in total. */
  totalMicro: number;
  /** The messages the top-up buys across the laps, at each lap's price. */
  newSms: number;
}

/** The budget top-up buttons of the laps header, in EUR. */
export const TOP_UP_AMOUNTS_EUR: readonly number[] = [5, 10, 20, 50, 100, 200];

/**
 * A budget top-up adds `amountMicro` to every active, priced lap; each one then sends
 * `amount / (price × parts)` more messages (`budgetPlan`), so a lap of two-part messages
 * does not spend twice the amount. Inactive and unpriced laps are left out.
 */
export function topUpPlan(input: TopUpPlanInput): TopUpPlan {
  if (!Number.isInteger(input.amountMicro) || input.amountMicro <= 0) {
    throw new RangeError(`amountMicro must be a positive integer, got ${input.amountMicro}`);
  }
  const parts = input.partsPerMessage ?? 1;
  if (!Number.isInteger(parts) || parts < 1) {
    throw new RangeError(`partsPerMessage must be a positive integer, got ${parts}`);
  }
  const laps: Array<{ id: string; extra: number }> = [];
  for (const lap of input.laps) {
    if (!lap.active || lap.priceMicro === null || lap.priceMicro <= 0) continue;
    laps.push({
      id: lap.id,
      extra: budgetPlan({ budgetMicro: input.amountMicro, priceMicro: lap.priceMicro * parts }),
    });
  }
  return {
    laps,
    activeLaps: laps.length,
    totalMicro: laps.length * input.amountMicro,
    newSms: laps.reduce((sum, lap) => sum + lap.extra, 0),
  };
}

function eurShort(micro: number): string {
  const eur = micro / 1_000_000;
  return `€${Number.isInteger(eur) ? eur.toLocaleString("en-GB") : eur.toFixed(2)}`;
}

/** The tooltip of a top-up button, as the spec words it. */
export function topUpTooltip(plan: TopUpPlan, amountMicro: number): string {
  if (plan.activeLaps === 0) return "No active lap to top up";
  const sends = plan.activeLaps === 1 ? "1 active send" : `${plan.activeLaps} active sends`;
  return `${sends} × ${eurShort(amountMicro)} = ${eurShort(plan.totalMicro)} · New SMS sent: ~${plan.newSms.toLocaleString("en-GB")} · Will spend an additional ${eurShort(amountMicro)} per each highlighted lap`;
}

// ---------------------------------------------------------------------------
// Routes that brought no clicks (D4-18)
// ---------------------------------------------------------------------------

/** What `routeResults` needs from a lap of the campaign. */
export interface RouteLapStats {
  routeId: string;
  status: "queued" | "sending" | "done" | "cancelled";
  sent: number;
  clicks: number;
}

/** One route's result in a campaign, summed over its laps. */
export interface RouteResult {
  routeId: string;
  sent: number;
  clicks: number;
  /** A lap on this route is still queued or sending, so its numbers can still move. */
  running: boolean;
}

/** Each route's sends and clicks in the campaign, in the order the routes first appear. */
export function routeResults(laps: readonly RouteLapStats[]): RouteResult[] {
  const byRoute = new Map<string, RouteResult>();
  for (const lap of laps) {
    const result = byRoute.get(lap.routeId) ?? {
      routeId: lap.routeId,
      sent: 0,
      clicks: 0,
      running: false,
    };
    result.sent += lap.sent;
    result.clicks += lap.clicks;
    if (lap.status === "queued" || lap.status === "sending") result.running = true;
    byRoute.set(lap.routeId, result);
  }
  return [...byRoute.values()];
}

/**
 * The picked routes to drop after a test, the way the team works a campaign: send a test on
 * several routes, then remove "the routes that brought in zero clicks". A route qualifies
 * when it sent at least one message in this campaign, none of its laps is still queued or
 * sending, and it got no click. Returned in the order of `pickedRouteIds`.
 */
export function zeroClickRouteIds(
  laps: readonly RouteLapStats[],
  pickedRouteIds: readonly string[],
): string[] {
  const results = new Map(routeResults(laps).map((r) => [r.routeId, r]));
  return pickedRouteIds.filter((id) => {
    const r = results.get(id);
    return r !== undefined && r.sent > 0 && r.clicks === 0 && !r.running;
  });
}
