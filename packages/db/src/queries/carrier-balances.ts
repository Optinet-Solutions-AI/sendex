import { and, asc, eq, isNull, or } from "drizzle-orm";
import { carrierBalances, routes } from "../schema/routes.js";
import type { Db } from "../types.js";
import { getBalanceMicro } from "./ledger.js";

/**
 * The balance Sendex shows and spends (D5-17) is the money on our accounts at the carriers,
 * read by the worker from each carrier's API, not Sendex's own ledger: Sendex is ours, so a
 * balance kept inside it says nothing. An organisation's balance is the sum of the carriers
 * behind its active routes (its own and the platform's), each counted once. Only when none
 * of them reports a balance does the ledger still count (development and carriers without a
 * balance API). The ledger keeps every debit for costs and reports.
 */

export interface SaveCarrierBalanceInput {
  provider: string;
  balanceMicro: bigint;
  currency: string;
  reportedAt: Date | null;
  checkedAt: Date;
}

/** Store the balance the worker just read from a carrier, replacing the previous one. */
export async function saveCarrierBalance(db: Db, input: SaveCarrierBalanceInput): Promise<void> {
  await db
    .insert(carrierBalances)
    .values(input)
    .onConflictDoUpdate({
      target: carrierBalances.provider,
      set: {
        balanceMicro: input.balanceMicro,
        currency: input.currency,
        reportedAt: input.reportedAt,
        checkedAt: input.checkedAt,
      },
    });
}

export interface CarrierBalanceView {
  provider: string;
  /** The organisation's route on this carrier, for display. */
  routeName: string;
  balanceMicro: bigint;
  currency: string;
  reportedAt: Date | null;
  checkedAt: Date;
}

export interface OrganisationBalance {
  /** `carrier`: the carriers' balances; `ledger`: none reports one, Sendex's own ledger. */
  source: "carrier" | "ledger";
  totalMicro: bigint;
  carriers: CarrierBalanceView[];
}

export async function organisationBalance(
  db: Db,
  organisationId: string,
): Promise<OrganisationBalance> {
  const rows = await db
    .select({
      provider: carrierBalances.provider,
      routeName: routes.name,
      balanceMicro: carrierBalances.balanceMicro,
      currency: carrierBalances.currency,
      reportedAt: carrierBalances.reportedAt,
      checkedAt: carrierBalances.checkedAt,
    })
    .from(routes)
    .innerJoin(carrierBalances, eq(carrierBalances.provider, routes.provider))
    .where(
      and(
        eq(routes.active, true),
        or(eq(routes.organisationId, organisationId), isNull(routes.organisationId)),
      ),
    )
    // The organisation's own route names come first, so they label the carrier.
    .orderBy(asc(carrierBalances.provider), asc(routes.organisationId), asc(routes.name));
  const carriers: CarrierBalanceView[] = [];
  for (const row of rows) {
    if (!carriers.some((c) => c.provider === row.provider)) carriers.push(row);
  }
  if (carriers.length === 0) {
    return { source: "ledger", totalMicro: await getBalanceMicro(db, organisationId), carriers };
  }
  return {
    source: "carrier",
    totalMicro: carriers.reduce((sum, c) => sum + c.balanceMicro, 0n),
    carriers,
  };
}

/** What the organisation can spend: its carriers' balances, or its ledger without any. */
export async function getSpendableBalanceMicro(db: Db, organisationId: string): Promise<bigint> {
  return (await organisationBalance(db, organisationId)).totalMicro;
}
