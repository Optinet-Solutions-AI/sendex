import { and, eq, gt, gte, isNotNull, lte, ne, or, sql } from "drizzle-orm";
import { ledgerEntries } from "../schema/ledger.js";
import { organisationSettings } from "../schema/settings.js";
import { messages } from "../schema/tracking.js";
import type { Db } from "../types.js";

/**
 * Sending volume and spend per organisation, as the daily caps and the spike rule need
 * them (D3-11). "Today" is the UTC day; the caller passes its start (`startOfUtcDay` in
 * packages/core) so a test can pin the clock.
 */

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" || typeof value === "bigint") return Number(value);
  throw new Error(`cannot convert ${String(value)} to number`);
}

function toBigInt(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" || typeof value === "string") return BigInt(value);
  throw new Error(`cannot convert ${String(value)} to bigint`);
}

const HOUR_MS = 3_600_000;
const WEEK_HOURS = 7 * 24;

export interface DailyUsage {
  /** Messages created since `dayStartUtc` in any status but `cancelled`. */
  messages: number;
  /** Net micro-EUR debited for messages since `dayStartUtc` (debits less refunds), never negative. */
  spentMicro: bigint;
}

/** Messages sent and money spent on them since midnight UTC, for `capDecision`. */
export async function dailyUsage(
  db: Db,
  organisationId: string,
  dayStartUtc: Date,
): Promise<DailyUsage> {
  const [sent, spent] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)`.mapWith(toNumber) })
      .from(messages)
      .where(
        and(
          eq(messages.organisationId, organisationId),
          gte(messages.createdAt, dayStartUtc),
          ne(messages.status, "cancelled"),
        ),
      ),
    db
      .select({
        net: sql<bigint>`coalesce(sum(${ledgerEntries.amountMicro}), 0)::bigint`.mapWith(toBigInt),
      })
      .from(ledgerEntries)
      .where(
        and(
          eq(ledgerEntries.organisationId, organisationId),
          gte(ledgerEntries.createdAt, dayStartUtc),
          eq(ledgerEntries.referenceType, "message"),
        ),
      ),
  ]);
  const net = spent[0]?.net ?? 0n;
  return { messages: sent[0]?.count ?? 0, spentMicro: net < 0n ? -net : 0n };
}

export interface SendRate {
  /** Non-cancelled messages created in the 60 minutes before `now`. */
  lastHour: number;
  /** Non-cancelled messages per hour over the 168 hours before that. */
  sevenDayHourlyAverage: number;
}

/** The inputs of `spikeDecision` for one organisation. */
export async function sendRate(db: Db, organisationId: string, now: Date): Promise<SendRate> {
  const hourAgo = new Date(now.getTime() - HOUR_MS);
  const weekBefore = new Date(hourAgo.getTime() - WEEK_HOURS * HOUR_MS);
  const [row] = await db
    .select({
      lastHour: sql<number>`count(*) filter (where ${gt(messages.createdAt, hourAgo)})`.mapWith(
        toNumber,
      ),
      week: sql<number>`count(*) filter (where ${lte(messages.createdAt, hourAgo)})`.mapWith(
        toNumber,
      ),
    })
    .from(messages)
    .where(
      and(
        eq(messages.organisationId, organisationId),
        gt(messages.createdAt, weekBefore),
        ne(messages.status, "cancelled"),
      ),
    );
  return {
    lastHour: row?.lastHour ?? 0,
    sevenDayHourlyAverage: (row?.week ?? 0) / WEEK_HOURS,
  };
}

/** Organisations that created a message after `since`: the ones worth a spike check. */
export async function organisationsWithRecentSends(db: Db, since: Date): Promise<string[]> {
  const rows = await db
    .selectDistinct({ organisationId: messages.organisationId })
    .from(messages)
    .where(gt(messages.createdAt, since));
  return rows.map((r) => r.organisationId);
}

/** Organisations with a low balance threshold set, or an alert still to be rearmed. */
export async function organisationsWithLowBalanceRule(db: Db): Promise<string[]> {
  const rows = await db
    .select({ organisationId: organisationSettings.organisationId })
    .from(organisationSettings)
    .where(
      or(
        isNotNull(organisationSettings.lowBalanceThresholdMicro),
        isNotNull(organisationSettings.lowBalanceAlertedAt),
      ),
    );
  return rows.map((r) => r.organisationId);
}
