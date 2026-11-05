export interface SendCountInput {
  testSize: number;
  lists: number;
  routes: number;
}

function assertNonNegativeInt(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer, got ${value}`);
  }
}

/** Send count = test size × lists × routes (each list/route pair becomes a lap). */
export function sendCount(input: SendCountInput): number {
  assertNonNegativeInt("testSize", input.testSize);
  assertNonNegativeInt("lists", input.lists);
  assertNonNegativeInt("routes", input.routes);
  return input.testSize * input.lists * input.routes;
}

export interface RouteCost {
  count: number;
  /** Price per SMS in EUR. */
  pricePerSms: number;
}

const MICRO = 1_000_000;

/** Estimated cost in EUR, computed in integer micro-euros. */
export function estimateCost(routes: readonly RouteCost[]): number {
  let micro = 0;
  for (const r of routes) {
    assertNonNegativeInt("count", r.count);
    micro += r.count * Math.round(r.pricePerSms * MICRO);
  }
  return micro / MICRO;
}
