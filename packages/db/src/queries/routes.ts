import {
  type CustomRouteInput,
  customRouteKind,
  isCustomProvider,
  type NetworkStat,
  orderRoutes,
  type RoutingExceptionInput,
  type RoutingStrategy,
  splitCustomRoute,
} from "@sendex/core";
import { and, asc, desc, eq, inArray, type SQL, sql } from "drizzle-orm";
import { routeConnectionEvents, routePrices, routes, routingExceptions } from "../schema/routes.js";
import { organisationSettings } from "../schema/settings.js";
import { openSecret, sealSecret } from "../secrets.js";
import type { Db } from "../types.js";
import { maskRecipient } from "./campaign-messages.js";
import { type RouteOption, routesForCountry } from "./campaigns.js";

/**
 * The Routes pages (D4-06): platform routes and their delivery report, a tenant's custom
 * routes (credentials sealed at rest), the routing configuration, the custom-route stats,
 * connection events and the Mobile Networks read model.
 */

function rowsOf(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  const maybe = result as { rows?: Record<string, unknown>[] };
  return maybe.rows ?? [];
}

const num = (v: unknown): number => Number(v ?? 0);
const big = (v: unknown): bigint => BigInt(String(v ?? "0"));
const text = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const date = (v: unknown): Date | null => {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
};

function codes(countries: readonly string[] | undefined): string[] {
  return (countries ?? []).map((c) => c.toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c));
}

function inCountries(column: SQL, countries: readonly string[] | undefined): SQL {
  const list = codes(countries);
  if (list.length === 0) return sql``;
  return sql` and ${column} in (${sql.join(
    list.map((c) => sql`${c}`),
    sql`, `,
  )})`;
}

export interface RouteWindow {
  from?: Date | undefined;
  to?: Date | undefined;
  countries?: readonly string[] | undefined;
}

function inWindow(column: SQL, filter: RouteWindow): SQL {
  const parts: SQL[] = [];
  if (filter.from) parts.push(sql` and ${column} >= ${filter.from.toISOString()}::timestamptz`);
  if (filter.to) parts.push(sql` and ${column} < ${filter.to.toISOString()}::timestamptz`);
  return sql.join(parts, sql``);
}

/** The latest price of every (route, country) pair, as a subquery alias `p`. */
const LATEST_PRICES = sql`(
  select distinct on (rp.route_id, rp.country) rp.route_id, rp.country, rp.price_micro
  from route_prices rp where rp.valid_from <= now()
  order by rp.route_id, rp.country, rp.valid_from desc) p`;

// ---------------------------------------------------------------------------
// Platform routes
// ---------------------------------------------------------------------------

export interface PlatformRouteRow {
  routeId: string;
  name: string;
  country: string;
  priceMicro: bigint;
}

/** Every active platform route per priced country ("Available Routes"), country A→Z. */
export async function platformRouteCatalogue(db: Db): Promise<PlatformRouteRow[]> {
  const rows = rowsOf(
    await db.execute(sql`
      select r.id as route_id, r.name, p.country, p.price_micro
      from routes r join ${LATEST_PRICES} on p.route_id = r.id
      where r.organisation_id is null and r.active = true
      order by p.country, r.name`),
  );
  return rows.map((r) => ({
    routeId: String(r.route_id),
    name: String(r.name),
    country: String(r.country),
    priceMicro: big(r.price_micro),
  }));
}

export interface DeliveryReportRow {
  country: string;
  routeId: string;
  routeName: string;
  priceMicro: bigint | null;
  sent: number;
  clicks: number;
  costMicro: bigint;
}

/** The organisation's sends on platform routes per country and route, busiest first. */
export async function platformDeliveryReport(
  db: Db,
  organisationId: string,
  filter: RouteWindow & { search?: string | undefined } = {},
): Promise<DeliveryReportRow[]> {
  const search = filter.search?.trim() ?? "";
  const pattern = `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const rows = rowsOf(
    await db.execute(sql`
      with f as (
        select m.id, m.route_id, coalesce(li.country, c.country) as country,
          exists (select 1 from clicks ck where ck.message_id = m.id and ck.device is distinct from 'bot') as clicked,
          (select coalesce(-sum(le.amount_micro), 0) from ledger_entries le
             where le.reference_type = 'message' and le.reference_id = m.id::text and le.kind in ('debit', 'fee')) as cost
        from messages m
        join routes r on r.id = m.route_id and r.organisation_id is null
        left join laps l on l.id = m.lap_id
        left join lists li on li.id = l.list_id
        left join campaigns c on c.id = m.campaign_id
        where m.organisation_id = ${organisationId}
          and m.status in ('sent', 'delivered', 'expired')${inWindow(sql`m.sent_at`, filter)}${inCountries(sql`coalesce(li.country, c.country)`, filter.countries)}
      )
      select f.country, f.route_id, r.name as route_name, p.price_micro,
        count(*)::int as sent, count(*) filter (where f.clicked)::int as clicks,
        coalesce(sum(f.cost), 0)::bigint as cost
      from f
      join routes r on r.id = f.route_id
      left join ${LATEST_PRICES} on p.route_id = f.route_id and p.country = f.country
      where ${search === "" ? sql`true` : sql`(r.name ilike ${pattern} or f.country ilike ${pattern})`}
      group by f.country, f.route_id, r.name, p.price_micro
      order by sent desc, f.country, r.name`),
  );
  return rows.map((r) => ({
    country: String(r.country ?? ""),
    routeId: String(r.route_id),
    routeName: String(r.route_name),
    priceMicro: r.price_micro === null || r.price_micro === undefined ? null : big(r.price_micro),
    sent: num(r.sent),
    clicks: num(r.clicks),
    costMicro: big(r.cost),
  }));
}

// ---------------------------------------------------------------------------
// Custom routes
// ---------------------------------------------------------------------------

export interface CustomRoutePrice {
  country: string;
  priceMicro: bigint;
}

export interface CustomRouteRow {
  id: string;
  name: string;
  provider: string;
  kind: "HTTP" | "SMPP";
  host: string;
  active: boolean;
  config: Record<string, unknown>;
  prices: CustomRoutePrice[];
  createdAt: Date;
  lastEventAt: Date | null;
}

/** "HTTP" or "SMPP": by provider for routes made here, by config shape for seeded ones. */
function kindOf(provider: string, config: Record<string, unknown>): "HTTP" | "SMPP" {
  return (
    customRouteKind(provider) ??
    (config.host !== undefined || provider === "smpp" ? "SMPP" : "HTTP")
  );
}

function hostOf(provider: string, config: Record<string, unknown>): string {
  if (typeof config.apiUrl === "string" && config.apiUrl !== "") {
    try {
      return new URL(config.apiUrl).host;
    } catch {
      return config.apiUrl;
    }
  }
  if (config.host !== undefined) return `${String(config.host)}:${String(config.port ?? "")}`;
  return provider;
}

/** The organisation's custom routes with their current prices, newest first. */
export async function listCustomRoutes(db: Db, organisationId: string): Promise<CustomRouteRow[]> {
  const rows = await db
    .select({
      id: routes.id,
      name: routes.name,
      provider: routes.provider,
      active: routes.active,
      config: routes.config,
      createdAt: routes.createdAt,
    })
    .from(routes)
    .where(eq(routes.organisationId, organisationId))
    .orderBy(desc(routes.createdAt), asc(routes.name));
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [prices, events] = await Promise.all([
    rowsOf(
      await db.execute(sql`
        select p.route_id, p.country, p.price_micro from ${LATEST_PRICES}
        where p.route_id in (${sql.join(
          ids.map((id) => sql`${id}`),
          sql`, `,
        )})
        order by p.country`),
    ),
    db
      .select({
        routeId: routeConnectionEvents.routeId,
        at: sql<Date>`max(${routeConnectionEvents.at})`,
      })
      .from(routeConnectionEvents)
      .where(inArray(routeConnectionEvents.routeId, ids))
      .groupBy(routeConnectionEvents.routeId),
  ]);
  const lastEvent = new Map(events.map((e) => [e.routeId, date(e.at)]));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    provider: r.provider,
    kind: kindOf(r.provider, r.config),
    host: hostOf(r.provider, r.config),
    active: r.active,
    config: r.config,
    prices: prices
      .filter((p) => String(p.route_id) === r.id)
      .map((p) => ({ country: String(p.country), priceMicro: big(p.price_micro) })),
    createdAt: r.createdAt,
    lastEventAt: lastEvent.get(r.id) ?? null,
  }));
}

/** Create a custom route; the password is sealed with `key` before it is stored. */
export async function createCustomRoute(
  db: Db,
  organisationId: string,
  input: CustomRouteInput,
  key: Buffer,
): Promise<{ id: string }> {
  const split = splitCustomRoute(input);
  const [row] = await db
    .insert(routes)
    .values({
      organisationId,
      provider: split.provider,
      name: input.name,
      country: null,
      active: true,
      config: split.config,
      secret: sealSecret(split.secret, key),
    })
    .returning({ id: routes.id });
  if (!row) throw new Error("createCustomRoute: no row returned");
  return row;
}

/** Update a custom route; a blank password keeps the sealed one. */
export async function updateCustomRoute(
  db: Db,
  organisationId: string,
  routeId: string,
  input: CustomRouteInput,
  key: Buffer,
): Promise<boolean> {
  const split = splitCustomRoute(input);
  const keepSecret = input.password === "";
  const [row] = await db
    .update(routes)
    .set({
      name: input.name,
      provider: split.provider,
      config: split.config,
      ...(keepSecret ? {} : { secret: sealSecret(split.secret, key) }),
    })
    .where(and(eq(routes.id, routeId), eq(routes.organisationId, organisationId)))
    .returning({ id: routes.id });
  return row !== undefined;
}

export async function setCustomRouteActive(
  db: Db,
  organisationId: string,
  routeId: string,
  active: boolean,
): Promise<boolean> {
  const [row] = await db
    .update(routes)
    .set({ active })
    .where(and(eq(routes.id, routeId), eq(routes.organisationId, organisationId)))
    .returning({ id: routes.id });
  return row !== undefined;
}

export async function deleteCustomRoute(
  db: Db,
  organisationId: string,
  routeId: string,
): Promise<boolean> {
  const [row] = await db
    .delete(routes)
    .where(and(eq(routes.id, routeId), eq(routes.organisationId, organisationId)))
    .returning({ id: routes.id });
  return row !== undefined;
}

/** Replace the route's prices: a new `route_prices` row per changed country, from now. */
export async function setCustomRoutePrices(
  db: Db,
  organisationId: string,
  routeId: string,
  prices: readonly CustomRoutePrice[],
): Promise<boolean> {
  const [route] = await db
    .select({ id: routes.id })
    .from(routes)
    .where(and(eq(routes.id, routeId), eq(routes.organisationId, organisationId)))
    .limit(1);
  if (!route) return false;
  const current = new Map(
    rowsOf(
      await db.execute(
        sql`select p.country, p.price_micro from ${LATEST_PRICES} where p.route_id = ${routeId}`,
      ),
    ).map((p) => [String(p.country), big(p.price_micro)]),
  );
  const changed = prices.filter((p) => current.get(p.country) !== p.priceMicro);
  if (changed.length > 0) {
    await db.insert(routePrices).values(
      // Stamped by the database clock so the latest-price lookup (also on its clock) sees it at once.
      changed.map((p) => ({ routeId, country: p.country, priceMicro: p.priceMicro })),
    );
  }
  return true;
}

export interface WorkerRoute {
  id: string;
  organisationId: string | null;
  provider: string;
  name: string;
  active: boolean;
  config: Record<string, unknown>;
  secret: string | null;
}

/** A route as the worker needs it to build a provider (no organisation scope: the worker owns every route). */
export async function getRouteForWorker(db: Db, routeId: string): Promise<WorkerRoute | null> {
  const [row] = await db
    .select({
      id: routes.id,
      organisationId: routes.organisationId,
      provider: routes.provider,
      name: routes.name,
      active: routes.active,
      config: routes.config,
      secret: routes.secret,
    })
    .from(routes)
    .where(eq(routes.id, routeId))
    .limit(1);
  return row ?? null;
}

/** The sealed credentials of a custom route, opened with `key`; `{}` for platform routes. */
export function openRouteSecret(
  route: Pick<WorkerRoute, "provider" | "secret">,
  key: Buffer,
): Record<string, string> {
  if (!isCustomProvider(route.provider) || !route.secret) return {};
  return openSecret<Record<string, string>>(route.secret, key);
}

export interface ConnectionEventInput {
  routeId: string;
  event: "bind" | "bind_failed" | "probe" | "probe_failed";
  source: "test_connection" | "send";
  host: string;
  latencyMs?: number | null;
  error?: string | null;
}

export async function recordConnectionEvent(
  db: Db,
  organisationId: string,
  input: ConnectionEventInput,
): Promise<void> {
  await db.insert(routeConnectionEvents).values({
    organisationId,
    routeId: input.routeId,
    event: input.event,
    source: input.source,
    host: input.host,
    latencyMs: input.latencyMs ?? null,
    error: input.error ?? null,
  });
}

export interface ConnectionEventRow {
  id: string;
  routeId: string;
  at: Date;
  event: string;
  source: string;
  host: string;
  latencyMs: number | null;
  error: string | null;
}

export async function listConnectionEvents(
  db: Db,
  organisationId: string,
  routeId: string,
  limit = 50,
): Promise<ConnectionEventRow[]> {
  return db
    .select({
      id: routeConnectionEvents.id,
      routeId: routeConnectionEvents.routeId,
      at: routeConnectionEvents.at,
      event: routeConnectionEvents.event,
      source: routeConnectionEvents.source,
      host: routeConnectionEvents.host,
      latencyMs: routeConnectionEvents.latencyMs,
      error: routeConnectionEvents.error,
    })
    .from(routeConnectionEvents)
    .where(
      and(
        eq(routeConnectionEvents.organisationId, organisationId),
        eq(routeConnectionEvents.routeId, routeId),
      ),
    )
    .orderBy(desc(routeConnectionEvents.at))
    .limit(limit);
}

// ---------------------------------------------------------------------------
// Routing configuration
// ---------------------------------------------------------------------------

export interface RoutingExceptionRow {
  country: string;
  routeOrder: string[];
  disabledRoutes: string[];
  lockedRoute: string | null;
}

export interface RoutingConfig {
  strategy: RoutingStrategy;
  feeMicro: bigint;
  exceptions: RoutingExceptionRow[];
}

const STRATEGIES: readonly RoutingStrategy[] = ["custom_first", "blended", "platform_first"];

export async function getRoutingConfig(db: Db, organisationId: string): Promise<RoutingConfig> {
  const [settings, exceptions] = await Promise.all([
    db
      .select({
        strategy: organisationSettings.routingStrategy,
        fee: organisationSettings.customRouteFeeMicro,
      })
      .from(organisationSettings)
      .where(eq(organisationSettings.organisationId, organisationId))
      .limit(1)
      .then((rows) => rows[0] ?? null),
    db
      .select({
        country: routingExceptions.country,
        routeOrder: routingExceptions.routeOrder,
        disabledRoutes: routingExceptions.disabledRoutes,
        lockedRoute: routingExceptions.lockedRoute,
      })
      .from(routingExceptions)
      .where(eq(routingExceptions.organisationId, organisationId))
      .orderBy(asc(routingExceptions.country)),
  ]);
  const strategy = settings?.strategy ?? "custom_first";
  return {
    strategy: (STRATEGIES as readonly string[]).includes(strategy)
      ? (strategy as RoutingStrategy)
      : "custom_first",
    feeMicro: settings?.fee ?? 10_000n,
    exceptions,
  };
}

export async function setRoutingStrategy(
  db: Db,
  organisationId: string,
  strategy: RoutingStrategy,
): Promise<void> {
  await db
    .insert(organisationSettings)
    .values({ organisationId, routingStrategy: strategy })
    .onConflictDoUpdate({
      target: organisationSettings.organisationId,
      set: { routingStrategy: strategy, updatedAt: new Date() },
    });
}

export async function upsertRoutingException(
  db: Db,
  organisationId: string,
  input: RoutingExceptionInput,
): Promise<void> {
  await db
    .insert(routingExceptions)
    .values({
      organisationId,
      country: input.country,
      routeOrder: input.routeOrder,
      disabledRoutes: input.disabledRoutes,
      lockedRoute: input.lockedRoute,
    })
    .onConflictDoUpdate({
      target: [routingExceptions.organisationId, routingExceptions.country],
      set: {
        routeOrder: input.routeOrder,
        disabledRoutes: input.disabledRoutes,
        lockedRoute: input.lockedRoute,
        updatedAt: new Date(),
      },
    });
}

export async function deleteRoutingException(
  db: Db,
  organisationId: string,
  country: string,
): Promise<boolean> {
  const [row] = await db
    .delete(routingExceptions)
    .where(
      and(
        eq(routingExceptions.organisationId, organisationId),
        eq(routingExceptions.country, country.toUpperCase()),
      ),
    )
    .returning({ id: routingExceptions.id });
  return row !== undefined;
}

/** Countries with at least one priced custom route (the exceptions UI offers these). */
export async function customRouteCountries(db: Db, organisationId: string): Promise<string[]> {
  const rows = rowsOf(
    await db.execute(sql`
      select distinct p.country from ${LATEST_PRICES}
      join routes r on r.id = p.route_id
      where r.organisation_id = ${organisationId}
      order by p.country`),
  );
  return rows.map((r) => String(r.country));
}

/** `routesForCountry` in the order the routing configuration gives for that country. */
export async function orderedRoutesForCountry(
  db: Db,
  organisationId: string,
  country: string,
): Promise<RouteOption[]> {
  const [options, config] = await Promise.all([
    routesForCountry(db, organisationId, country),
    getRoutingConfig(db, organisationId),
  ]);
  const exception = config.exceptions.find((e) => e.country === country.toUpperCase()) ?? null;
  return orderRoutes(options, config.strategy, exception);
}

// ---------------------------------------------------------------------------
// Custom route stats
// ---------------------------------------------------------------------------

export interface SendingStatRow {
  routeId: string;
  routeName: string;
  /** Present when grouped by route and country. */
  country: string | null;
  sent: number;
  delivered: number;
  clicks: number;
}

/** Sending Statistics on the Stats tab: the organisation's custom routes, by route (and country). */
export async function customRouteSendingStats(
  db: Db,
  organisationId: string,
  input: RouteWindow & { byCountry?: boolean | undefined },
): Promise<SendingStatRow[]> {
  const countryCol = input.byCountry ? sql`coalesce(li.country, c.country)` : sql`null::text`;
  const rows = rowsOf(
    await db.execute(sql`
      select m.route_id, r.name as route_name, ${countryCol} as country,
        count(*)::int as sent,
        count(*) filter (where m.status = 'delivered')::int as delivered,
        count(*) filter (where exists (select 1 from clicks ck where ck.message_id = m.id and ck.device is distinct from 'bot'))::int as clicks
      from messages m
      join routes r on r.id = m.route_id and r.organisation_id = ${organisationId}
      left join laps l on l.id = m.lap_id
      left join lists li on li.id = l.list_id
      left join campaigns c on c.id = m.campaign_id
      where m.organisation_id = ${organisationId}
        and m.status in ('sent', 'delivered', 'expired')${inWindow(sql`m.sent_at`, input)}
      group by m.route_id, r.name, ${countryCol}
      order by sent desc, r.name`),
  );
  return rows.map((r) => ({
    routeId: String(r.route_id),
    routeName: String(r.route_name),
    country: text(r.country),
    sent: num(r.sent),
    delivered: num(r.delivered),
    clicks: num(r.clicks),
  }));
}

export interface SmsLogRow {
  id: string;
  at: Date;
  routeName: string;
  country: string;
  recipient: string;
  text: string;
  status: string;
  costMicro: bigint;
}

/** The SMS Log on the Stats tab: the most recent sends on the custom routes. */
export async function customRouteSmsLog(
  db: Db,
  organisationId: string,
  input: RouteWindow & { routeId?: string | undefined; limit?: number | undefined },
): Promise<SmsLogRow[]> {
  const limit = Math.min(200, Math.max(1, input.limit ?? 50));
  const rows = rowsOf(
    await db.execute(sql`
      select m.id, coalesce(m.sent_at, m.created_at) as at, r.name as route_name,
        coalesce(li.country, c.country, t.country, '') as country, m.e164, m.text, m.status,
        (select coalesce(-sum(le.amount_micro), 0) from ledger_entries le
           where le.reference_type = 'message' and le.reference_id = m.id::text and le.kind in ('debit', 'fee')) as cost
      from messages m
      join routes r on r.id = m.route_id and r.organisation_id = ${organisationId}
      left join laps l on l.id = m.lap_id
      left join lists li on li.id = l.list_id
      left join campaigns c on c.id = m.campaign_id
      left join sms_tests t on t.id = m.test_id
      where m.organisation_id = ${organisationId}${input.routeId ? sql` and m.route_id = ${input.routeId}` : sql``}${inWindow(sql`coalesce(m.sent_at, m.created_at)`, input)}
      order by coalesce(m.sent_at, m.created_at) desc limit ${limit}`),
  );
  return rows.map((r) => ({
    id: String(r.id),
    at: date(r.at) ?? new Date(0),
    routeName: String(r.route_name),
    country: String(r.country ?? ""),
    recipient: maskRecipient(String(r.e164)),
    text: String(r.text),
    status: String(r.status),
    costMicro: big(r.cost),
  }));
}

// ---------------------------------------------------------------------------
// Mobile networks
// ---------------------------------------------------------------------------

/** Operator stats per country, operator and route ("Unresolved" when no receipt or click named one). */
export async function networkStats(
  db: Db,
  organisationId: string,
  input: RouteWindow & { routeIds?: readonly string[] | undefined; search?: string | undefined },
): Promise<NetworkStat[]> {
  const search = input.search?.trim() ?? "";
  const pattern = `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const routeFilter =
    input.routeIds && input.routeIds.length > 0
      ? sql` and m.route_id in (${sql.join(
          input.routeIds.map((id) => sql`${id}`),
          sql`, `,
        )})`
      : sql``;
  const rows = rowsOf(
    await db.execute(sql`
      select coalesce(li.country, c.country, t.country) as country,
        coalesce(m.operator, 'Unresolved') as operator, m.route_id, r.name as route_name,
        count(*)::int as sent,
        (select count(*) from clicks ck where ck.message_id = any(array_agg(m.id)) and ck.device = 'bot')::int as previews,
        count(*) filter (where exists (select 1 from clicks ck where ck.message_id = m.id and ck.device is distinct from 'bot'))::int as clicks,
        (select count(*) from postbacks p where p.message_id = any(array_agg(m.id)) and p.type = 'lead')::int as leads,
        (select count(*) from postbacks p where p.message_id = any(array_agg(m.id)) and p.type = 'sale')::int as sales
      from messages m
      join routes r on r.id = m.route_id
      left join laps l on l.id = m.lap_id
      left join lists li on li.id = l.list_id
      left join campaigns c on c.id = m.campaign_id
      left join sms_tests t on t.id = m.test_id
      where m.organisation_id = ${organisationId}
        and m.status in ('sent', 'delivered', 'expired')${inWindow(sql`m.sent_at`, input)}${inCountries(sql`coalesce(li.country, c.country, t.country)`, input.countries)}${routeFilter}
        and ${search === "" ? sql`true` : sql`(coalesce(m.operator, 'Unresolved') ilike ${pattern} or coalesce(li.country, c.country, t.country) ilike ${pattern})`}
      group by 1, 2, 3, 4
      order by 1, 2, sent desc`),
  );
  return rows.map((r) => ({
    country: String(r.country ?? ""),
    operator: String(r.operator),
    routeId: String(r.route_id),
    routeName: String(r.route_name),
    sent: num(r.sent),
    previews: num(r.previews),
    clicks: num(r.clicks),
    leads: num(r.leads),
    sales: num(r.sales),
  }));
}

/** Route names for the Mobile Networks route filter: every route the organisation sent on. */
export async function sentRouteOptions(
  db: Db,
  organisationId: string,
): Promise<Array<{ id: string; name: string }>> {
  const rows = rowsOf(
    await db.execute(sql`
      select distinct r.id, r.name from messages m join routes r on r.id = m.route_id
      where m.organisation_id = ${organisationId} order by r.name`),
  );
  return rows.map((r) => ({ id: String(r.id), name: String(r.name) }));
}
