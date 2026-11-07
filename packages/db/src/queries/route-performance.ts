import { type RouteRank, rankRoutes } from "@sendex/core";
import { and, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { laps } from "../schema/campaigns.js";
import { lists } from "../schema/lists.js";
import { routes } from "../schema/routes.js";
import { clicks, messages } from "../schema/tracking.js";
import type { Db } from "../types.js";
import { routesForCountry } from "./campaigns.js";

/**
 * The Routes tab of the send form (D4-02): "Platform Statistics" ranks every platform route
 * for the country across all organisations (anonymous ranks only, never another tenant's
 * numbers) and "Account Statistics" is this organisation's own cost, sent, clicks, CTR and
 * CPC per route, each for the last day, week and month.
 */

export const PERFORMANCE_PERIODS = ["daily", "weekly", "monthly"] as const;
export type PerformancePeriod = (typeof PERFORMANCE_PERIODS)[number];

const PERIOD_MS: Record<PerformancePeriod, number> = {
  daily: 24 * 3_600_000,
  weekly: 7 * 24 * 3_600_000,
  monthly: 30 * 24 * 3_600_000,
};

export interface PlatformRankRow {
  routeId: string;
  name: string;
  priceMicro: bigint | null;
  ctrRank: number | null;
  cpcRank: number | null;
  overallRank: number | null;
}

export interface AccountStatRow {
  routeId: string;
  name: string;
  priceMicro: bigint | null;
  costMicro: bigint;
  sent: number;
  clicks: number;
  ctr: number;
  cpcMicro: bigint | null;
}

export interface RoutePerformance {
  country: string;
  platform: Record<PerformancePeriod, PlatformRankRow[]>;
  account: Record<PerformancePeriod, AccountStatRow[]>;
}

interface Counters {
  routeId: string;
  sent: number;
  clicks: number;
  costMicro: bigint;
}

/**
 * Messages sent since `since` (by sent_at), distinct clicked messages and ledger cost per route, for messages of
 * lists in `country`; scoped to one organisation or, for the platform ranks, to platform
 * routes across every organisation.
 */
async function counters(
  db: Db,
  input: { country: string; since: Date; routeIds: readonly string[]; organisationId?: string },
): Promise<Counters[]> {
  if (input.routeIds.length === 0) return [];
  const rows = await db
    .select({
      routeId: messages.routeId,
      sent: sql<number>`count(distinct ${messages.id})`.mapWith(Number),
      clicks: sql<number>`count(distinct ${clicks.messageId})`.mapWith(Number),
      costMicro: sql<bigint>`coalesce(-sum(le.amount_micro), 0)::bigint`.mapWith(BigInt),
    })
    .from(messages)
    .innerJoin(laps, eq(laps.id, messages.lapId))
    .innerJoin(lists, eq(lists.id, laps.listId))
    .leftJoin(clicks, eq(clicks.messageId, messages.id))
    .leftJoin(
      sql`ledger_entries le`,
      sql`le.reference_type = 'message' and le.reference_id = ${messages.id}::text`,
    )
    .where(
      and(
        eq(lists.country, input.country),
        gte(messages.sentAt, input.since),
        inArray(messages.routeId, [...input.routeIds]),
        input.organisationId === undefined
          ? isNull(routes.organisationId)
          : eq(messages.organisationId, input.organisationId),
      ),
    )
    .innerJoin(routes, eq(routes.id, messages.routeId))
    .groupBy(messages.routeId);
  return rows.map((r) => ({ ...r, routeId: r.routeId ?? "" }));
}

export async function routePerformance(
  db: Db,
  organisationId: string,
  country: string,
  now: Date = new Date(),
): Promise<RoutePerformance> {
  const code = country.toUpperCase();
  const options = await routesForCountry(db, organisationId, code);
  const platformIds = options.filter((o) => o.platform).map((o) => o.id);
  const allIds = options.map((o) => o.id);
  const byId = new Map(options.map((o) => [o.id, o]));

  const platform = {} as Record<PerformancePeriod, PlatformRankRow[]>;
  const account = {} as Record<PerformancePeriod, AccountStatRow[]>;
  for (const period of PERFORMANCE_PERIODS) {
    const since = new Date(now.getTime() - PERIOD_MS[period]);
    const [shared, own] = await Promise.all([
      counters(db, { country: code, since, routeIds: platformIds }),
      counters(db, { country: code, since, routeIds: allIds, organisationId }),
    ]);
    const ranks = new Map<string, RouteRank>(
      rankRoutes(
        platformIds.map((id) => {
          const c = shared.find((s) => s.routeId === id);
          return {
            routeId: id,
            sent: c?.sent ?? 0,
            clicks: c?.clicks ?? 0,
            costMicro: Number(c?.costMicro ?? 0n),
          };
        }),
      ).map((r) => [r.routeId, r]),
    );
    platform[period] = platformIds.map((id) => {
      const o = byId.get(id);
      const r = ranks.get(id);
      return {
        routeId: id,
        name: o?.name ?? "",
        priceMicro: o?.priceMicro ?? null,
        ctrRank: r?.ctrRank ?? null,
        cpcRank: r?.cpcRank ?? null,
        overallRank: r?.overallRank ?? null,
      };
    });
    account[period] = allIds.map((id) => {
      const o = byId.get(id);
      const c = own.find((s) => s.routeId === id);
      const sent = c?.sent ?? 0;
      const clicked = c?.clicks ?? 0;
      const costMicro = c?.costMicro ?? 0n;
      return {
        routeId: id,
        name: o?.name ?? "",
        priceMicro: o?.priceMicro ?? null,
        costMicro,
        sent,
        clicks: clicked,
        ctr: sent > 0 ? clicked / sent : 0,
        cpcMicro: clicked > 0 ? costMicro / BigInt(clicked) : null,
      };
    });
  }
  return { country: code, platform, account };
}
