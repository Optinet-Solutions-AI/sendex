/**
 * Route performance ranks for the Routes tab (D4-02): platform routes ranked against each
 * other for a country by CTR, by cost per click and overall. Pure; the db package feeds it
 * per-period counters and the page shows the ranks (never another tenant's numbers).
 */

export interface RouteStat {
  routeId: string;
  sent: number;
  clicks: number;
  costMicro: number;
}

export interface RouteRank {
  routeId: string;
  /** 1 = highest CTR; null when the route sent nothing in the period. */
  ctrRank: number | null;
  /** 1 = cheapest click; null when the route got no click in the period. */
  cpcRank: number | null;
  /** 1 = best: highest CTR, then lowest CPC, then most sent; null when nothing was sent. */
  overallRank: number | null;
  ctr: number;
  cpcMicro: number | null;
}

function dense(
  rows: RouteRank[],
  eligible: (r: RouteRank) => boolean,
  compare: (a: RouteRank, b: RouteRank) => number,
  assign: (r: RouteRank, rank: number) => void,
): void {
  const ranked = rows.filter(eligible).sort(compare);
  for (const [i, r] of ranked.entries()) assign(r, i + 1);
}

export function rankRoutes(stats: readonly RouteStat[]): RouteRank[] {
  const rows: RouteRank[] = stats.map((s) => ({
    routeId: s.routeId,
    ctrRank: null,
    cpcRank: null,
    overallRank: null,
    ctr: s.sent > 0 ? s.clicks / s.sent : 0,
    cpcMicro: s.clicks > 0 ? Math.round(s.costMicro / s.clicks) : null,
  }));
  const sent = new Map(stats.map((s) => [s.routeId, s.sent]));
  const bySent = (a: RouteRank, b: RouteRank) =>
    (sent.get(b.routeId) ?? 0) - (sent.get(a.routeId) ?? 0);

  dense(
    rows,
    (r) => (sent.get(r.routeId) ?? 0) > 0,
    (a, b) => b.ctr - a.ctr || bySent(a, b),
    (r, rank) => {
      r.ctrRank = rank;
    },
  );
  dense(
    rows,
    (r) => r.cpcMicro !== null,
    (a, b) => (a.cpcMicro ?? 0) - (b.cpcMicro ?? 0) || bySent(a, b),
    (r, rank) => {
      r.cpcRank = rank;
    },
  );
  dense(
    rows,
    (r) => (sent.get(r.routeId) ?? 0) > 0,
    (a, b) =>
      b.ctr - a.ctr ||
      (a.cpcMicro ?? Number.POSITIVE_INFINITY) - (b.cpcMicro ?? Number.POSITIVE_INFINITY) ||
      bySent(a, b),
    (r, rank) => {
      r.overallRank = rank;
    },
  );
  return rows;
}
