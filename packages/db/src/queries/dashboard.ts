import { and, eq, sql } from "drizzle-orm";
import { laps } from "../schema/campaigns.js";
import { contacts } from "../schema/lists.js";
import { postbacks } from "../schema/tracking.js";
import type { Db } from "../types.js";

/** The four tiles of the dashboard's Getting Started tab. */
export interface DashboardTotals {
  /** Contacts on file in this organisation. */
  contacts: number;
  /** Messages the carriers accepted, across every lap. */
  sent: number;
  /** What the laps debited, in micro-EUR. */
  spendMicro: bigint;
  /** Sales (FTDs) reported by postbacks. */
  sales: number;
}

/** One round trip per tile; every number comes from the rows the sends and postbacks write. */
export async function getDashboardTotals(db: Db, organisationId: string): Promise<DashboardTotals> {
  const [contactRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(contacts)
    .where(eq(contacts.organisationId, organisationId));
  const [lapRow] = await db
    .select({
      sent: sql<number>`coalesce(sum(${laps.sent}), 0)::int`,
      spendMicro: sql<string>`coalesce(sum(${laps.costMicro}), 0)::text`,
    })
    .from(laps)
    .where(eq(laps.organisationId, organisationId));
  const [salesRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(postbacks)
    .where(and(eq(postbacks.organisationId, organisationId), eq(postbacks.type, "sale")));
  return {
    contacts: contactRow?.n ?? 0,
    sent: lapRow?.sent ?? 0,
    spendMicro: BigInt(lapRow?.spendMicro ?? "0"),
    sales: salesRow?.n ?? 0,
  };
}
