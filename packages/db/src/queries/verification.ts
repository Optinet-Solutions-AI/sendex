import {
  type EnrichmentRuleInput,
  eurToMicroBudget,
  LOOKUP_STATUSES,
  type LookupStatus,
  lookupVerdict,
} from "@sendex/core";
import { and, asc, desc, eq, type SQL, sql } from "drizzle-orm";
import { ledgerEntries } from "../schema/ledger.js";
import {
  contacts,
  enrichmentRules,
  lookupPrices,
  lookupResults,
  verificationRequests,
} from "../schema/lists.js";
import type { Db } from "../types.js";

/**
 * Numbers Verification (D4-07): the organisation's lookup cache, enrichment rules, the
 * verification log, the network breakdown and coverage prices, plus the worker's request
 * cycle (claim, targets, record, finish). Lookups cost money: every verified number is a
 * ledger debit with `reference_type = 'lookup'`.
 */

function rowsOf(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  const maybe = result as { rows?: Record<string, unknown>[] };
  return maybe.rows ?? [];
}

const num = (v: unknown): number => Number(v ?? 0);
const big = (v: unknown): bigint => BigInt(String(v ?? "0"));

/** One carrier answer, as `LookupProvider.lookup` in packages/providers shapes it. */
export interface LookupOutcome {
  e164: string;
  status: "hlr" | "mnp" | "unresolved" | "local_only" | "bad";
  method: string;
  operator: string | null;
  ported: boolean;
}

export type EnrichmentRuleRow = typeof enrichmentRules.$inferSelect;
export type VerificationRequestRow = typeof verificationRequests.$inferSelect;

// ---------------------------------------------------------------------------
// KPIs, log, breakdown, coverage
// ---------------------------------------------------------------------------

export interface LookupCounts {
  totalUnique: number;
  byStatus: Partial<Record<LookupStatus, number>>;
}

/** Unique numbers on file and how many carry each lookup status. */
export async function lookupCounts(db: Db, organisationId: string): Promise<LookupCounts> {
  const [contactRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(contacts)
    .where(eq(contacts.organisationId, organisationId));
  const rows = await db
    .select({ status: lookupResults.status, n: sql<number>`count(*)::int` })
    .from(lookupResults)
    .where(eq(lookupResults.organisationId, organisationId))
    .groupBy(lookupResults.status);
  const byStatus: Partial<Record<LookupStatus, number>> = {};
  for (const r of rows) {
    if ((LOOKUP_STATUSES as readonly string[]).includes(r.status)) {
      byStatus[r.status as LookupStatus] = Number(r.n);
    }
  }
  return { totalUnique: Number(contactRow?.n ?? 0), byStatus };
}

export async function listEnrichmentRules(
  db: Db,
  organisationId: string,
): Promise<EnrichmentRuleRow[]> {
  return db
    .select()
    .from(enrichmentRules)
    .where(eq(enrichmentRules.organisationId, organisationId))
    .orderBy(asc(enrichmentRules.country));
}

/** Create or replace the rule of a country (one rule per country). */
export async function upsertEnrichmentRule(
  db: Db,
  organisationId: string,
  input: EnrichmentRuleInput,
): Promise<EnrichmentRuleRow> {
  const values = {
    dailyLimit: input.dailyLimit,
    monthlyBudgetMicro: eurToMicroBudget(input.monthlyBudgetEur),
    onSchedule: input.onSchedule,
    afterUpload: input.afterUpload,
    asYouSend: input.asYouSend,
    includeArchived: input.includeArchived,
    active: true,
  };
  const [row] = await db
    .insert(enrichmentRules)
    .values({ organisationId, country: input.country, ...values })
    .onConflictDoUpdate({
      target: [enrichmentRules.organisationId, enrichmentRules.country],
      set: values,
    })
    .returning();
  if (!row) throw new Error("upsertEnrichmentRule: no row returned");
  return row;
}

/** A rule by id, for the worker (no organisation scope: the worker owns every rule). */
export async function getEnrichmentRuleById(db: Db, id: string): Promise<EnrichmentRuleRow | null> {
  const [row] = await db.select().from(enrichmentRules).where(eq(enrichmentRules.id, id)).limit(1);
  return row ?? null;
}

export async function deleteEnrichmentRule(
  db: Db,
  organisationId: string,
  id: string,
): Promise<boolean> {
  const [row] = await db
    .delete(enrichmentRules)
    .where(and(eq(enrichmentRules.id, id), eq(enrichmentRules.organisationId, organisationId)))
    .returning({ id: enrichmentRules.id });
  return row !== undefined;
}

export interface VerificationLogRow {
  day: string;
  country: string;
  total: number;
  good: number;
  bad: number;
  noVerdict: number;
  costMicro: bigint;
}

export interface LogWindow {
  from?: Date | undefined;
  to?: Date | undefined;
  country?: string | undefined;
}

/** The Verification log: one row per day and country, newest first. */
export async function verificationLog(
  db: Db,
  organisationId: string,
  window: LogWindow = {},
): Promise<VerificationLogRow[]> {
  const conditions: SQL[] = [eq(verificationRequests.organisationId, organisationId)];
  if (window.from)
    conditions.push(
      sql`${verificationRequests.requestedAt} >= ${window.from.toISOString()}::timestamptz`,
    );
  if (window.to)
    conditions.push(
      sql`${verificationRequests.requestedAt} < ${window.to.toISOString()}::timestamptz`,
    );
  if (window.country)
    conditions.push(eq(verificationRequests.country, window.country.toUpperCase()));
  const day = sql<string>`(${verificationRequests.requestedAt} at time zone 'UTC')::date::text`;
  const rows = await db
    .select({
      day,
      country: verificationRequests.country,
      total: sql<number>`coalesce(sum(${verificationRequests.total}), 0)::int`,
      good: sql<number>`coalesce(sum(${verificationRequests.good}), 0)::int`,
      bad: sql<number>`coalesce(sum(${verificationRequests.bad}), 0)::int`,
      noVerdict: sql<number>`coalesce(sum(${verificationRequests.noVerdict}), 0)::int`,
      cost: sql<string>`coalesce(sum(${verificationRequests.costMicro}), 0)::text`,
    })
    .from(verificationRequests)
    .where(and(...conditions))
    .groupBy(day, verificationRequests.country)
    .orderBy(desc(day), asc(verificationRequests.country));
  return rows.map((r) => ({
    day: String(r.day).slice(0, 10),
    country: r.country,
    total: Number(r.total),
    good: Number(r.good),
    bad: Number(r.bad),
    noVerdict: Number(r.noVerdict),
    costMicro: BigInt(r.cost),
  }));
}

export interface NetworkBreakdownRow {
  country: string;
  operator: string;
  numbers: number;
  ported: number;
}

/** Country network breakdown: operators the lookups named, busiest first. */
export async function networkBreakdown(
  db: Db,
  organisationId: string,
): Promise<NetworkBreakdownRow[]> {
  const rows = await db
    .select({
      country: lookupResults.country,
      operator: sql<string>`coalesce(${lookupResults.operator}, 'Unknown')`,
      numbers: sql<number>`count(*)::int`,
      ported: sql<number>`count(*) filter (where ${lookupResults.ported})::int`,
    })
    .from(lookupResults)
    .where(
      and(
        eq(lookupResults.organisationId, organisationId),
        sql`${lookupResults.operator} is not null`,
      ),
    )
    .groupBy(lookupResults.country, lookupResults.operator)
    .orderBy(desc(sql`count(*)`), asc(lookupResults.country))
    .limit(100);
  return rows.map((r) => ({
    country: r.country,
    operator: r.operator,
    numbers: Number(r.numbers),
    ported: Number(r.ported),
  }));
}

export interface CoverageRow {
  country: string;
  route: string;
  method: string;
  priceMicro: bigint;
}

/** The current lookup route, method and price per country (Verification coverage). */
export async function lookupCoverage(db: Db): Promise<CoverageRow[]> {
  const rows = rowsOf(
    await db.execute(sql`
      select distinct on (country) country, route, method, price_micro from lookup_prices
      where valid_from <= now() order by country, valid_from desc`),
  );
  return rows.map((r) => ({
    country: String(r.country),
    route: String(r.route),
    method: String(r.method),
    priceMicro: big(r.price_micro),
  }));
}

export async function lookupPriceFor(db: Db, country: string): Promise<CoverageRow | null> {
  const [row] = await db
    .select()
    .from(lookupPrices)
    .where(
      and(eq(lookupPrices.country, country.toUpperCase()), sql`${lookupPrices.validFrom} <= now()`),
    )
    .orderBy(desc(lookupPrices.validFrom))
    .limit(1);
  return row
    ? { country: row.country, route: row.route, method: row.method, priceMicro: row.priceMicro }
    : null;
}

export async function setLookupPrice(
  db: Db,
  input: { country: string; route: string; method: "hlr" | "mnp"; priceMicro: bigint },
): Promise<void> {
  await db.insert(lookupPrices).values({ ...input, country: input.country.toUpperCase() });
}

// ---------------------------------------------------------------------------
// Requests (web creates, worker runs)
// ---------------------------------------------------------------------------

export interface CreateVerificationRequestInput {
  country: string;
  source: "rule" | "hlr_verify" | "upload" | "send";
  listId?: string | null;
  ruleId?: string | null;
  limit: number;
  requestedBy?: string | null;
}

export async function createVerificationRequest(
  db: Db,
  organisationId: string,
  input: CreateVerificationRequestInput,
): Promise<VerificationRequestRow> {
  const [row] = await db
    .insert(verificationRequests)
    .values({
      organisationId,
      country: input.country.toUpperCase(),
      source: input.source,
      listId: input.listId ?? null,
      ruleId: input.ruleId ?? null,
      limit: Math.max(0, input.limit),
      requestedBy: input.requestedBy ?? null,
    })
    .returning();
  if (!row) throw new Error("createVerificationRequest: no row returned");
  return row;
}

/** Numbers of a list (or a country) that have no lookup result yet. */
export async function countUnverified(
  db: Db,
  organisationId: string,
  scope: { listId?: string | undefined; country?: string | undefined; includeArchived?: boolean },
): Promise<number> {
  const rows = rowsOf(await db.execute(unverifiedSql(organisationId, scope, "count")));
  return num(rows[0]?.n);
}

function unverifiedSql(
  organisationId: string,
  scope: { listId?: string | undefined; country?: string | undefined; includeArchived?: boolean },
  mode: "count" | "rows",
  limit = 0,
): SQL {
  const select =
    mode === "count" ? sql`count(distinct c.id)::int as n` : sql`distinct c.id, c.e164, c.country`;
  const listFilter = scope.listId ? sql` and lm.list_id = ${scope.listId}` : sql``;
  const countryFilter = scope.country
    ? sql` and c.country = ${scope.country.toUpperCase()}`
    : sql``;
  const archivedFilter = scope.includeArchived ? sql`` : sql` and l.archived_at is null`;
  const limitSql = mode === "rows" && limit > 0 ? sql` limit ${limit}` : sql``;
  return sql`
    select ${select}
    from contacts c
    join list_members lm on lm.contact_id = c.id and lm.bad = false
    join lists l on l.id = lm.list_id
    where c.organisation_id = ${organisationId}${listFilter}${countryFilter}${archivedFilter}
      and not exists (select 1 from lookup_results lr where lr.organisation_id = c.organisation_id and lr.e164 = c.e164)${limitSql}`;
}

export async function listQueuedVerificationRequests(db: Db): Promise<VerificationRequestRow[]> {
  return db
    .select()
    .from(verificationRequests)
    .where(eq(verificationRequests.status, "queued"))
    .orderBy(asc(verificationRequests.requestedAt))
    .limit(50);
}

export async function claimVerificationRequest(
  db: Db,
  id: string,
): Promise<VerificationRequestRow | null> {
  const [row] = await db
    .update(verificationRequests)
    .set({ status: "running" })
    .where(and(eq(verificationRequests.id, id), eq(verificationRequests.status, "queued")))
    .returning();
  return row ?? null;
}

export interface VerificationTarget {
  contactId: string;
  e164: string;
  country: string;
}

/** The numbers a request should verify: unverified, in its list or country, up to its limit. */
export async function verificationTargets(
  db: Db,
  request: Pick<
    VerificationRequestRow,
    "organisationId" | "country" | "listId" | "limit" | "ruleId"
  >,
  includeArchived = false,
): Promise<VerificationTarget[]> {
  const rows = rowsOf(
    await db.execute(
      unverifiedSql(
        request.organisationId,
        {
          listId: request.listId ?? undefined,
          country: request.listId ? undefined : request.country,
          includeArchived,
        },
        "rows",
        request.limit,
      ),
    ),
  );
  return rows.map((r) => ({
    contactId: String(r.id),
    e164: String(r.e164),
    country: String(r.country),
  }));
}

export interface RecordLookupsInput {
  request: Pick<VerificationRequestRow, "id" | "organisationId" | "country">;
  results: readonly LookupOutcome[];
  priceMicro: bigint;
  provider: string;
}

/**
 * Store the results of a batch (one row per number, replacing an older result), debit each
 * number, flag `bad` members, and add the verdicts to the request. Suppressed numbers are
 * stored as `blacklisted` whatever the carrier said. One transaction.
 */
export async function recordLookupResults(db: Db, input: RecordLookupsInput): Promise<void> {
  if (input.results.length === 0) return;
  const { request } = input;
  await db.transaction(async (tx) => {
    const suppressed = new Set(
      rowsOf(
        await tx.execute(sql`
          select e164 from suppressions where organisation_id = ${request.organisationId}
            and e164 in (${sql.join(
              input.results.map((r) => sql`${r.e164}`),
              sql`, `,
            )})`),
      ).map((r) => String(r.e164)),
    );
    let good = 0;
    let bad = 0;
    let none = 0;
    for (const r of input.results) {
      const status: LookupStatus = suppressed.has(r.e164) ? "blacklisted" : r.status;
      const verdict = lookupVerdict(status);
      if (verdict === "good") good += 1;
      else if (verdict === "bad") bad += 1;
      else none += 1;
      await tx
        .insert(lookupResults)
        .values({
          organisationId: request.organisationId,
          e164: r.e164,
          country: request.country,
          status,
          method: r.method,
          operator: r.operator,
          ported: r.ported,
          priceMicro: input.priceMicro,
          provider: input.provider,
          requestId: request.id,
        })
        .onConflictDoUpdate({
          target: [lookupResults.organisationId, lookupResults.e164],
          set: {
            status,
            method: r.method,
            operator: r.operator,
            ported: r.ported,
            priceMicro: input.priceMicro,
            provider: input.provider,
            requestId: request.id,
            checkedAt: new Date(),
          },
        });
      if (input.priceMicro > 0n) {
        await tx
          .insert(ledgerEntries)
          .values({
            organisationId: request.organisationId,
            kind: "debit",
            amountMicro: -input.priceMicro,
            referenceType: "lookup",
            referenceId: request.id,
            idempotencyKey: `lookup:${request.id}:${r.e164}`,
            note: `lookup ${r.e164.slice(0, 5)}…`,
          })
          .onConflictDoNothing({ target: ledgerEntries.idempotencyKey });
      }
      if (verdict === "bad") {
        await tx.execute(sql`
          update list_members lm set bad = true, bad_reason = 'lookup'
          from contacts c
          where c.id = lm.contact_id and c.organisation_id = ${request.organisationId} and c.e164 = ${r.e164}
            and lm.bad = false`);
      }
    }
    await tx
      .update(verificationRequests)
      .set({
        total: sql`${verificationRequests.total} + ${input.results.length}`,
        good: sql`${verificationRequests.good} + ${good}`,
        bad: sql`${verificationRequests.bad} + ${bad}`,
        noVerdict: sql`${verificationRequests.noVerdict} + ${none}`,
        costMicro: sql`${verificationRequests.costMicro} + ${input.priceMicro * BigInt(input.results.length)}`,
      })
      .where(eq(verificationRequests.id, request.id));
  });
}

export async function finishVerificationRequest(
  db: Db,
  id: string,
  status: "done" | "failed",
): Promise<void> {
  await db
    .update(verificationRequests)
    .set({ status, finishedAt: new Date() })
    .where(eq(verificationRequests.id, id));
}

export interface RuleUsage {
  verifiedToday: number;
  spentThisMonthMicro: bigint;
}

/** What a rule has used today and this month (UTC), from its requests. */
export async function ruleUsage(
  db: Db,
  ruleId: string,
  now: Date = new Date(),
): Promise<RuleUsage> {
  const day = now.toISOString().slice(0, 10);
  const month = now.toISOString().slice(0, 7);
  const [row] = await db
    .select({
      today: sql<number>`coalesce(sum(${verificationRequests.total}) filter (where to_char(${verificationRequests.requestedAt} at time zone 'UTC', 'YYYY-MM-DD') = ${day}), 0)::int`,
      month: sql<string>`coalesce(sum(${verificationRequests.costMicro}) filter (where to_char(${verificationRequests.requestedAt} at time zone 'UTC', 'YYYY-MM') = ${month}), 0)::text`,
    })
    .from(verificationRequests)
    .where(eq(verificationRequests.ruleId, ruleId));
  return { verifiedToday: Number(row?.today ?? 0), spentThisMonthMicro: BigInt(row?.month ?? "0") };
}

/** Active rules that run on a schedule, across every organisation (the worker tick). */
export async function scheduledEnrichmentRules(db: Db): Promise<EnrichmentRuleRow[]> {
  return db
    .select()
    .from(enrichmentRules)
    .where(and(eq(enrichmentRules.active, true), eq(enrichmentRules.onSchedule, true)));
}

// ---------------------------------------------------------------------------
// Lookup columns of the list details page
// ---------------------------------------------------------------------------

export interface ListLookupCounts {
  country: string;
  hlr: number;
  mnp: number;
  unresolved: number;
  localOnly: number;
  checking: number;
  cached: number;
}

/** Per country of a list: how many members carry each lookup status (cached = any result). */
export async function listLookupCounts(
  db: Db,
  organisationId: string,
  listId: string,
): Promise<ListLookupCounts[]> {
  const rows = rowsOf(
    await db.execute(sql`
      select c.country,
        count(*) filter (where lr.status = 'hlr')::int as hlr,
        count(*) filter (where lr.status = 'mnp')::int as mnp,
        count(*) filter (where lr.status = 'unresolved')::int as unresolved,
        count(*) filter (where lr.status = 'local_only')::int as local_only,
        count(*) filter (where lr.status = 'checking')::int as checking,
        count(*) filter (where lr.id is not null)::int as cached
      from list_members lm
      join contacts c on c.id = lm.contact_id
      left join lookup_results lr on lr.organisation_id = c.organisation_id and lr.e164 = c.e164
      where lm.list_id = ${listId} and lm.organisation_id = ${organisationId}
      group by c.country`),
  );
  return rows.map((r) => ({
    country: String(r.country),
    hlr: num(r.hlr),
    mnp: num(r.mnp),
    unresolved: num(r.unresolved),
    localOnly: num(r.local_only),
    checking: num(r.checking),
    cached: num(r.cached),
  }));
}
