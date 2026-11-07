import {
  describeSegment,
  isSegmentGroup,
  type SegmentGroup,
  type SegmentLookups,
  type SegmentRule,
  segmentField,
  segmentGroupSchema,
  validateSegment,
} from "@sendex/core";
import { and, asc, desc, eq, ilike, inArray, isNotNull, type SQL, sql } from "drizzle-orm";
import { campaigns, segments } from "../schema/campaigns.js";
import { lists } from "../schema/lists.js";
import type { Db } from "../types.js";
import { maskRecipient } from "./campaign-messages.js";

/**
 * Segments (D4-04): the rule tree compiles to one SQL condition over `contacts c`, with
 * correlated subqueries for the contact's messages, clicks, postbacks and memberships, so a
 * segment is always evaluated live. Every helper is scoped by organisation.
 */

export type SegmentRow = typeof segments.$inferSelect;

const toNumber = (v: unknown): number => Number(v ?? 0);

// ---------------------------------------------------------------------------
// Compiling a rule tree to SQL
// ---------------------------------------------------------------------------

/** `c` is the contacts row the condition is evaluated for; `org` the bound organisation id. */
function metric(key: string, org: string, C: SQL): SQL {
  const msgs = sql`messages m where m.organisation_id = ${org} and m.contact_id = ${C}.id and m.sent_at is not null`;
  switch (key) {
    case "sent_count":
      return sql`(select count(*) from ${msgs})`;
    case "clicks_count":
      return sql`(select count(distinct ck.message_id) from clicks ck join messages m on m.id = ck.message_id where m.organisation_id = ${org} and m.contact_id = ${C}.id)`;
    case "ctr_level":
      return sql`(select coalesce(100.0 * count(distinct ck.message_id) / nullif((select count(*) from ${msgs}), 0), 0) from clicks ck join messages m on m.id = ck.message_id where m.organisation_id = ${org} and m.contact_id = ${C}.id)`;
    case "leads":
      return sql`(select count(*) from postbacks p join messages m on m.id = p.message_id where m.organisation_id = ${org} and m.contact_id = ${C}.id and p.type = 'lead')`;
    case "sales":
      return sql`(select count(*) from postbacks p join messages m on m.id = p.message_id where m.organisation_id = ${org} and m.contact_id = ${C}.id and p.type = 'sale')`;
    case "cost_per_click":
      return sql`(select coalesce((select -sum(le.amount_micro) from ledger_entries le join messages m on le.reference_id = m.id::text where le.reference_type = 'message' and m.organisation_id = ${org} and m.contact_id = ${C}.id) / 1000000.0 / nullif((select count(distinct ck.message_id) from clicks ck join messages m on m.id = ck.message_id where m.organisation_id = ${org} and m.contact_id = ${C}.id), 0), 0))`;
    case "dlr_delivered":
      return sql`(select count(*) from messages m where m.organisation_id = ${org} and m.contact_id = ${C}.id and m.status = 'delivered')`;
    case "dlr_rejected":
      return sql`(select count(*) from messages m where m.organisation_id = ${org} and m.contact_id = ${C}.id and m.status = 'failed')`;
    case "dlr_expired":
      return sql`(select count(*) from messages m where m.organisation_id = ${org} and m.contact_id = ${C}.id and m.status = 'expired')`;
    case "dlr_delivery_rate":
      return sql`(select coalesce(100.0 * count(*) filter (where m.status = 'delivered') / nullif(count(*), 0), 0) from ${msgs})`;
    case "last_received_sms":
      return sql`(select max(m.sent_at) from ${msgs})`;
    case "last_clicked":
      return sql`(select max(ck.at) from clicks ck join messages m on m.id = ck.message_id where m.organisation_id = ${org} and m.contact_id = ${C}.id)`;
    case "last_lead":
      return sql`(select max(p.received_at) from postbacks p join messages m on m.id = p.message_id where m.organisation_id = ${org} and m.contact_id = ${C}.id and p.type = 'lead')`;
    case "last_sale":
      return sql`(select max(p.received_at) from postbacks p join messages m on m.id = p.message_id where m.organisation_id = ${org} and m.contact_id = ${C}.id and p.type = 'sale')`;
    case "number_added":
      return sql`${C}.created_at`;
    case "list_created":
      return sql`(select max(l.created_at) from list_members lm join lists l on l.id = lm.list_id where lm.contact_id = ${C}.id)`;
    case "first_name":
      return sql`${C}.first_name`;
    case "last_name":
      return sql`${C}.last_name`;
    case "email":
      return sql`${C}.email`;
    case "list_name":
      return sql`(select string_agg(l.name, ' | ') from list_members lm join lists l on l.id = lm.list_id where lm.contact_id = ${C}.id)`;
    case "browser":
      return sql`(select string_agg(ck.user_agent, ' | ') from clicks ck join messages m on m.id = ck.message_id where m.organisation_id = ${org} and m.contact_id = ${C}.id)`;
    default:
      throw new Error(`segment: no metric for ${key}`);
  }
}

/** "contact has at least one X among `values`" for the enum fields backed by rows, not columns. */
function membership(key: string, org: string, values: readonly string[], C: SQL): SQL {
  switch (key) {
    case "list":
      return sql`exists (select 1 from list_members lm where lm.contact_id = ${C}.id and lm.list_id in ${values})`;
    case "sent_in_campaign":
      return sql`exists (select 1 from messages m where m.organisation_id = ${org} and m.contact_id = ${C}.id and m.sent_at is not null and m.campaign_id in ${values})`;
    case "lead_in_campaign":
      return sql`exists (select 1 from postbacks p join messages m on m.id = p.message_id where m.organisation_id = ${org} and m.contact_id = ${C}.id and p.type = 'lead' and p.campaign_id in ${values})`;
    case "clicked_in_campaign":
      return sql`exists (select 1 from clicks ck join messages m on m.id = ck.message_id where m.organisation_id = ${org} and m.contact_id = ${C}.id and ck.campaign_id in ${values})`;
    case "device":
      return sql`exists (select 1 from clicks ck join messages m on m.id = ck.message_id where m.organisation_id = ${org} and m.contact_id = ${C}.id and ck.device in ${values})`;
    case "mobile_network":
      return sql`exists (select 1 from clicks ck join messages m on m.id = ck.message_id where m.organisation_id = ${org} and m.contact_id = ${C}.id and ck.operator in ${values})`;
    case "click_country":
      return sql`exists (select 1 from clicks ck join messages m on m.id = ck.message_id where m.organisation_id = ${org} and m.contact_id = ${C}.id and ck.country in ${values})`;
    case "country":
      return sql`${C}.country in ${values}`;
    default:
      throw new Error(`segment: no membership for ${key}`);
  }
}

function asStrings(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  return value === undefined || value === null ? [] : [String(value)];
}

function compileRule(rule: SegmentRule, org: string, C: SQL): SQL {
  const def = segmentField(rule.field);
  if (!def) throw new Error(`segment: unknown field ${rule.field}`);
  if (def.kind === "enum") {
    const values = asStrings(rule.value);
    if (values.length === 0) throw new Error(`segment: ${rule.field} needs a value`);
    const positive = membership(rule.field, org, values, C);
    return rule.operator === "not_equals" || rule.operator === "not_in"
      ? sql`not ${positive}`
      : positive;
  }
  const expr = metric(rule.field, org, C);
  if (def.kind === "number") {
    const n = Number(rule.value);
    switch (rule.operator) {
      case "equals":
        return sql`${expr} = ${n}`;
      case "not_equals":
        return sql`${expr} <> ${n}`;
      case "gt":
        return sql`${expr} > ${n}`;
      case "gte":
        return sql`${expr} >= ${n}`;
      case "lt":
        return sql`${expr} < ${n}`;
      case "lte":
        return sql`${expr} <= ${n}`;
      case "between": {
        const [lo, hi] = Array.isArray(rule.value) ? rule.value : [0, 0];
        return sql`${expr} between ${Number(lo)} and ${Number(hi)}`;
      }
    }
  }
  if (def.kind === "date") {
    switch (rule.operator) {
      case "within_days":
        return sql`${expr} >= now() - make_interval(days => ${Number(rule.value)})`;
      case "not_within_days":
        return sql`(${expr} is null or ${expr} < now() - make_interval(days => ${Number(rule.value)}))`;
      case "before":
        return sql`${expr} < ${String(rule.value)}::timestamptz`;
      case "after":
        return sql`${expr} >= (${String(rule.value)}::timestamptz + interval '1 day')`;
      case "is_set":
        return sql`${expr} is not null`;
      case "is_not_set":
        return sql`${expr} is null`;
    }
  }
  if (def.kind === "text") {
    const v = String(rule.value ?? "");
    switch (rule.operator) {
      case "equals":
        return sql`lower(coalesce(${expr}, '')) = lower(${v})`;
      case "not_equals":
        return sql`lower(coalesce(${expr}, '')) <> lower(${v})`;
      case "contains":
        return sql`coalesce(${expr}, '') ilike ${`%${v}%`}`;
      case "not_contains":
        return sql`coalesce(${expr}, '') not ilike ${`%${v}%`}`;
      case "is_set":
        return sql`coalesce(${expr}, '') <> ''`;
      case "is_not_set":
        return sql`coalesce(${expr}, '') = ''`;
    }
  }
  throw new Error(`segment: unsupported operator ${rule.operator} for ${rule.field}`);
}

/** The whole tree as one condition; an empty group matches nothing (so a draft has no audience). */
export function compileSegment(group: SegmentGroup, organisationId: string, alias = "c"): SQL {
  const C = sql.raw(alias);
  const parts = group.rules.map((node) =>
    isSegmentGroup(node)
      ? compileSegment(node, organisationId, alias)
      : compileRule(node, organisationId, C),
  );
  if (parts.length === 0) return sql`false`;
  const glue = group.op === "and" ? sql` and ` : sql` or `;
  return sql`(${sql.join(parts, glue)})`;
}

// ---------------------------------------------------------------------------
// Preview and stats
// ---------------------------------------------------------------------------

export interface SegmentBreakdownRow {
  key: string;
  count: number;
}

export interface SegmentPreview {
  total: number;
  /** Matching contacts that could be sent to: not suppressed, in at least one list as not bad. */
  good: number;
  cached: number;
  /** Up to ten masked numbers. */
  sample: string[];
  countries: SegmentBreakdownRow[];
  networks: SegmentBreakdownRow[];
  devices: SegmentBreakdownRow[];
}

function goodSql(org: string, C: SQL): SQL {
  return sql`(not exists (select 1 from suppressions s where s.organisation_id = ${org} and s.e164 = ${C}.e164)
    and exists (select 1 from list_members lm where lm.contact_id = ${C}.id and lm.bad = false))`;
}

/** Count, good, a sample and the three breakdowns for a rule tree; throws on an invalid tree. */
export async function previewSegment(
  db: Db,
  organisationId: string,
  definition: SegmentGroup,
  options: { sample?: number } = {},
): Promise<SegmentPreview> {
  const parsed = segmentGroupSchema.parse(definition);
  const C = sql.raw("c");
  const problems = validateSegment(parsed);
  if (problems.length > 0) throw new Error(problems[0]?.message ?? "Invalid segment");
  const where = sql`${C}.organisation_id = ${organisationId} and ${compileSegment(parsed, organisationId)}`;
  const good = goodSql(organisationId, C);
  const sampleSize = Math.max(0, Math.min(options.sample ?? 10, 100));
  const [[counts], sample, countries, networks, devices] = await Promise.all([
    db
      .select({
        total: sql<number>`count(*)`.mapWith(toNumber),
        good: sql<number>`count(*) filter (where ${good})`.mapWith(toNumber),
      })
      .from(sql`contacts c`)
      .where(where),
    db
      .select({ e164: sql<string>`${C}.e164` })
      .from(sql`contacts c`)
      .where(where)
      .orderBy(sql`random()`)
      .limit(sampleSize),
    db
      .select({ key: sql<string>`${C}.country`, count: sql<number>`count(*)`.mapWith(toNumber) })
      .from(sql`contacts c`)
      .where(where)
      .groupBy(sql`${C}.country`)
      .orderBy(desc(sql`count(*)`))
      .limit(10),
    db
      .select({
        key: sql<string>`coalesce(ck.operator, 'Unknown')`,
        count: sql<number>`count(distinct ${C}.id)`.mapWith(toNumber),
      })
      .from(sql`contacts c`)
      .innerJoin(
        sql`messages m`,
        sql`m.contact_id = ${C}.id and m.organisation_id = ${organisationId}`,
      )
      .innerJoin(sql`clicks ck`, sql`ck.message_id = m.id`)
      .where(where)
      .groupBy(sql`coalesce(ck.operator, 'Unknown')`)
      .orderBy(desc(sql`count(distinct ${C}.id)`))
      .limit(10),
    db
      .select({
        key: sql<string>`coalesce(ck.device, 'unknown')`,
        count: sql<number>`count(distinct ${C}.id)`.mapWith(toNumber),
      })
      .from(sql`contacts c`)
      .innerJoin(
        sql`messages m`,
        sql`m.contact_id = ${C}.id and m.organisation_id = ${organisationId}`,
      )
      .innerJoin(sql`clicks ck`, sql`ck.message_id = m.id`)
      .where(where)
      .groupBy(sql`coalesce(ck.device, 'unknown')`)
      .orderBy(desc(sql`count(distinct ${C}.id)`))
      .limit(10),
  ]);
  return {
    total: counts?.total ?? 0,
    good: counts?.good ?? 0,
    cached: 0,
    sample: sample.map((r) => maskRecipient(r.e164)),
    countries,
    networks,
    devices,
  };
}

/** Every matching number in full, for the CSV export; scoped and capped by the caller's page. */
export async function segmentNumbers(
  db: Db,
  organisationId: string,
  definition: SegmentGroup,
  options: { page: number; pageSize: number },
): Promise<string[]> {
  const parsed = segmentGroupSchema.parse(definition);
  const C = sql.raw("c");
  const rows = await db
    .select({ e164: sql<string>`${C}.e164` })
    .from(sql`contacts c`)
    .where(
      sql`${C}.organisation_id = ${organisationId} and ${compileSegment(parsed, organisationId)}`,
    )
    .orderBy(sql`${C}.e164`)
    .limit(Math.max(1, options.pageSize))
    .offset((Math.max(1, options.page) - 1) * Math.max(1, options.pageSize));
  return rows.map((r) => r.e164);
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export interface SegmentWriteInput {
  name: string;
  definition: SegmentGroup;
  isTemplate: boolean;
  globalExclude: boolean;
}

async function lookups(db: Db, organisationId: string): Promise<SegmentLookups> {
  const [listRows, campaignRows] = await Promise.all([
    db
      .select({ id: lists.id, name: lists.name })
      .from(lists)
      .where(eq(lists.organisationId, organisationId)),
    db
      .select({ id: campaigns.id, name: campaigns.name })
      .from(campaigns)
      .where(eq(campaigns.organisationId, organisationId)),
  ]);
  return {
    lists: new Map(listRows.map((r) => [r.id, r.name])),
    campaigns: new Map(campaignRows.map((r) => [r.id, r.name])),
  };
}

export async function createSegment(
  db: Db,
  organisationId: string,
  input: SegmentWriteInput,
): Promise<SegmentRow> {
  const definition = segmentGroupSchema.parse(input.definition);
  const summary = describeSegment(definition, await lookups(db, organisationId));
  const [row] = await db
    .insert(segments)
    .values({
      organisationId,
      name: input.name,
      definition: definition as unknown as Record<string, unknown>,
      summary,
      isTemplate: input.isTemplate,
      globalExclude: input.globalExclude,
    })
    .returning();
  if (!row) throw new Error("createSegment: no row returned");
  return row;
}

export async function updateSegment(
  db: Db,
  organisationId: string,
  segmentId: string,
  input: SegmentWriteInput,
): Promise<SegmentRow> {
  const definition = segmentGroupSchema.parse(input.definition);
  const summary = describeSegment(definition, await lookups(db, organisationId));
  const [row] = await db
    .update(segments)
    .set({
      name: input.name,
      definition: definition as unknown as Record<string, unknown>,
      summary,
      isTemplate: input.isTemplate,
      globalExclude: input.globalExclude,
      size: null,
      good: null,
      statsAt: null,
      updatedAt: new Date(),
    })
    .where(and(eq(segments.id, segmentId), eq(segments.organisationId, organisationId)))
    .returning();
  if (!row) throw new Error("Segment not found");
  return row;
}

export async function getSegment(
  db: Db,
  organisationId: string,
  segmentId: string,
): Promise<SegmentRow | null> {
  const [row] = await db
    .select()
    .from(segments)
    .where(and(eq(segments.id, segmentId), eq(segments.organisationId, organisationId)))
    .limit(1);
  return row ?? null;
}

export type SegmentsTab = "all" | "templates" | "excludes";

export interface ListSegmentsOptions {
  tab: SegmentsTab;
  search?: string;
  sort?: "name" | "size" | "good" | "createdAt";
  dir?: "asc" | "desc";
}

export interface SegmentsListing {
  rows: SegmentRow[];
  counts: { all: number; templates: number; excludes: number };
}

export async function listSegments(
  db: Db,
  organisationId: string,
  options: ListSegmentsOptions,
): Promise<SegmentsListing> {
  const conditions: SQL[] = [eq(segments.organisationId, organisationId)];
  if (options.tab === "templates") conditions.push(eq(segments.isTemplate, true));
  if (options.tab === "excludes") conditions.push(eq(segments.globalExclude, true));
  const search = options.search?.trim();
  if (search) conditions.push(ilike(segments.name, `%${search.replace(/[%_\\]/g, "\\$&")}%`));
  const column =
    options.sort === "name"
      ? segments.name
      : options.sort === "size"
        ? segments.size
        : options.sort === "good"
          ? segments.good
          : segments.createdAt;
  const order = options.dir === "asc" ? asc(column) : desc(column);
  const [rows, [counts]] = await Promise.all([
    db
      .select()
      .from(segments)
      .where(and(...conditions))
      .orderBy(order, asc(segments.id)),
    db
      .select({
        all: sql<number>`count(*)`.mapWith(toNumber),
        templates: sql<number>`count(*) filter (where ${segments.isTemplate})`.mapWith(toNumber),
        excludes: sql<number>`count(*) filter (where ${segments.globalExclude})`.mapWith(toNumber),
      })
      .from(segments)
      .where(eq(segments.organisationId, organisationId)),
  ]);
  return {
    rows,
    counts: {
      all: counts?.all ?? 0,
      templates: counts?.templates ?? 0,
      excludes: counts?.excludes ?? 0,
    },
  };
}

export async function duplicateSegment(
  db: Db,
  organisationId: string,
  segmentId: string,
): Promise<SegmentRow> {
  const source = await getSegment(db, organisationId, segmentId);
  if (!source) throw new Error("Segment not found");
  return createSegment(db, organisationId, {
    name: `Copy of ${source.name}`,
    definition: segmentGroupSchema.parse(source.definition),
    isTemplate: source.isTemplate,
    globalExclude: false,
  });
}

export async function deleteSegment(
  db: Db,
  organisationId: string,
  segmentId: string,
): Promise<boolean> {
  const deleted = await db
    .delete(segments)
    .where(and(eq(segments.id, segmentId), eq(segments.organisationId, organisationId)))
    .returning({ id: segments.id });
  return deleted.length > 0;
}

/** Refresh Stats: recount size and good for the given segments (or all of the organisation's). */
export async function refreshSegmentStats(
  db: Db,
  organisationId: string,
  segmentIds?: readonly string[],
): Promise<number> {
  const rows = await db
    .select({ id: segments.id, definition: segments.definition })
    .from(segments)
    .where(
      and(
        eq(segments.organisationId, organisationId),
        segmentIds && segmentIds.length > 0 ? inArray(segments.id, [...segmentIds]) : undefined,
      ),
    );
  for (const row of rows) {
    const definition = segmentGroupSchema.parse(row.definition);
    let size = 0;
    let good = 0;
    if (validateSegment(definition).length === 0 && definition.rules.length > 0) {
      const preview = await previewSegment(db, organisationId, definition, { sample: 0 });
      size = preview.total;
      good = preview.good;
    }
    await db
      .update(segments)
      .set({ size, good, statsAt: new Date() })
      .where(eq(segments.id, row.id));
  }
  return rows.length;
}

/** The organisation's global exclude segments, compiled; `null` when there are none. */
export async function globalExcludeCondition(
  db: Db,
  organisationId: string,
  alias = "c",
): Promise<SQL | null> {
  const rows = await db
    .select({ definition: segments.definition })
    .from(segments)
    .where(
      and(
        eq(segments.organisationId, organisationId),
        eq(segments.globalExclude, true),
        isNotNull(segments.definition),
      ),
    );
  const parts: SQL[] = [];
  for (const row of rows) {
    const definition = segmentGroupSchema.parse(row.definition);
    if (definition.rules.length === 0 || validateSegment(definition).length > 0) continue;
    parts.push(compileSegment(definition, organisationId, alias));
  }
  if (parts.length === 0) return null;
  return sql`(${sql.join(parts, sql` or `)})`;
}

/** Campaign names for the builder's enum pickers, newest first. */
export async function listCampaignNames(
  db: Db,
  organisationId: string,
): Promise<Array<{ id: string; name: string }>> {
  return db
    .select({ id: campaigns.id, name: campaigns.name })
    .from(campaigns)
    .where(eq(campaigns.organisationId, organisationId))
    .orderBy(desc(campaigns.createdAt))
    .limit(500);
}

/** Mobile networks seen in the organisation's clicks, for the Mobile Network picker. */
export async function clickOperators(db: Db, organisationId: string): Promise<string[]> {
  const rows = await db
    .select({ operator: sql<string>`distinct ck.operator` })
    .from(sql`clicks ck`)
    .where(sql`ck.organisation_id = ${organisationId} and ck.operator is not null`)
    .orderBy(sql`ck.operator`)
    .limit(200);
  return rows.map((r) => r.operator);
}

/**
 * One segment as a condition over the contacts table aliased `alias`; `false` when the
 * segment is missing, empty or invalid, so a stale lap sends nothing rather than everything.
 */
export async function segmentCondition(
  db: Db,
  organisationId: string,
  segmentId: string,
  alias = "c",
): Promise<SQL> {
  const row = await getSegment(db, organisationId, segmentId);
  if (!row) return sql`false`;
  const definition = segmentGroupSchema.parse(row.definition);
  if (definition.rules.length === 0 || validateSegment(definition).length > 0) return sql`false`;
  return compileSegment(definition, organisationId, alias);
}

/** `db.execute` returns a row list on postgres-js and `{ rows }` on PGlite. */
function rowsOf(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  const maybe = result as { rows?: Record<string, unknown>[] };
  return maybe.rows ?? [];
}

/**
 * How many contacts of each live list in `country` match the segment and could still be
 * sent to (not bad, unsent or flushed, not suppressed): the laps a segment audience plans.
 */
export async function segmentListAvailability(
  db: Db,
  organisationId: string,
  segmentId: string,
  country: string,
): Promise<Array<{ listId: string; available: number }>> {
  const cond = await segmentCondition(db, organisationId, segmentId, "c");
  const rows = rowsOf(
    await db.execute(sql`
      select lm.list_id as list_id, count(*) as available
      from list_members lm
      join contacts c on c.id = lm.contact_id
      join lists l on l.id = lm.list_id
      where lm.organisation_id = ${organisationId}
        and l.organisation_id = ${organisationId}
        and l.country = ${country.toUpperCase()}
        and l.archived_at is null
        and lm.bad = false
        and (lm.sent_at is null or lm.flushed_at > lm.sent_at)
        and not exists (select 1 from suppressions s
          where s.organisation_id = ${organisationId} and s.e164 = c.e164)
        and ${cond}
      group by lm.list_id
      order by available desc
    `),
  );
  return rows.map((r) => ({ listId: String(r.list_id), available: Number(r.available ?? 0) }));
}
