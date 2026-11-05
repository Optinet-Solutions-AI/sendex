import { eq, type SQL, sql } from "drizzle-orm";
import { ledgerEntries } from "../schema/ledger.js";
import type { Db } from "../types.js";

/** Drivers return int8 aggregates as string, number or bigint; normalise. */
function toBigInt(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" || typeof value === "string") return BigInt(value);
  throw new Error(`cannot convert ${String(value)} to bigint`);
}

/**
 * Scalar subquery giving the organisation's balance in micro-EUR as the sum of
 * its ledger entries (debits are negative). Embed it in a select or a where
 * clause, e.g. to check funds inside the transaction that writes a debit.
 */
export function balanceSql(organisationId: string): SQL<bigint> {
  return sql<bigint>`(select coalesce(sum(${ledgerEntries.amountMicro}), 0)::bigint from ${ledgerEntries} where ${ledgerEntries.organisationId} = ${organisationId})`.mapWith(
    toBigInt,
  );
}

/** The organisation's balance in micro-EUR. */
export async function getBalanceMicro(db: Db, organisationId: string): Promise<bigint> {
  const [row] = await db
    .select({
      balanceMicro: sql<bigint>`coalesce(sum(${ledgerEntries.amountMicro}), 0)::bigint`.mapWith(
        toBigInt,
      ),
    })
    .from(ledgerEntries)
    .where(eq(ledgerEntries.organisationId, organisationId));
  return row?.balanceMicro ?? 0n;
}
