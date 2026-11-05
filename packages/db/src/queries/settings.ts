import { MAX_LOW_BALANCE_EMAILS } from "@sendex/core";
import { eq } from "drizzle-orm";
import { organisationSettings } from "../schema/settings.js";
import type { Db } from "../types.js";

export type OrganisationSettingsRow = typeof organisationSettings.$inferSelect;

/** The billing settings as the app sees them; defaults when no row exists yet. */
export interface OrganisationSettings {
  organisationId: string;
  lowBalanceThresholdMicro: bigint | null;
  lowBalanceEmails: string[];
  lowBalanceAlertedAt: Date | null;
  dailyMessageCap: number | null;
  dailySpendCapMicro: bigint | null;
}

export interface UpdateSettingsInput {
  lowBalanceThresholdMicro: bigint | null;
  lowBalanceEmails: string[];
  dailyMessageCap: number | null;
  dailySpendCapMicro: bigint | null;
}

function fromRow(row: OrganisationSettingsRow): OrganisationSettings {
  return {
    organisationId: row.organisationId,
    lowBalanceThresholdMicro: row.lowBalanceThresholdMicro,
    lowBalanceEmails: row.lowBalanceEmails,
    lowBalanceAlertedAt: row.lowBalanceAlertedAt,
    dailyMessageCap: row.dailyMessageCap,
    dailySpendCapMicro: row.dailySpendCapMicro,
  };
}

/** The organisation's billing settings, or the defaults when nothing was saved yet. */
export async function getSettings(db: Db, organisationId: string): Promise<OrganisationSettings> {
  const [row] = await db
    .select()
    .from(organisationSettings)
    .where(eq(organisationSettings.organisationId, organisationId))
    .limit(1);
  if (row) return fromRow(row);
  return {
    organisationId,
    lowBalanceThresholdMicro: null,
    lowBalanceEmails: [],
    lowBalanceAlertedAt: null,
    dailyMessageCap: null,
    dailySpendCapMicro: null,
  };
}

/** Create or replace the organisation's settings. The alert timestamp is left alone. */
export async function updateSettings(
  db: Db,
  organisationId: string,
  input: UpdateSettingsInput,
): Promise<OrganisationSettings> {
  if (input.lowBalanceEmails.length > MAX_LOW_BALANCE_EMAILS) {
    throw new Error(`At most five low balance emails (${MAX_LOW_BALANCE_EMAILS})`);
  }
  const values = {
    lowBalanceThresholdMicro: input.lowBalanceThresholdMicro,
    lowBalanceEmails: input.lowBalanceEmails,
    dailyMessageCap: input.dailyMessageCap,
    dailySpendCapMicro: input.dailySpendCapMicro,
  };
  const [row] = await db
    .insert(organisationSettings)
    .values({ organisationId, ...values })
    .onConflictDoUpdate({
      target: organisationSettings.organisationId,
      set: { ...values, updatedAt: new Date() },
    })
    .returning();
  if (!row) throw new Error("updateSettings: no row returned");
  return fromRow(row);
}

/**
 * Store when the low balance alert fired (`at`) or clear it (`null`) once the balance
 * recovered; the decision comes from `shouldAlertLowBalance` in packages/core.
 */
export async function markLowBalanceAlerted(
  db: Db,
  organisationId: string,
  at: Date | null,
): Promise<void> {
  await db
    .insert(organisationSettings)
    .values({ organisationId, lowBalanceAlertedAt: at })
    .onConflictDoUpdate({
      target: organisationSettings.organisationId,
      set: { lowBalanceAlertedAt: at, updatedAt: new Date() },
    });
}
