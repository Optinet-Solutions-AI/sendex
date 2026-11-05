import { bigint, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { organisations } from "./core.js";

/**
 * Per-organisation billing settings: the low balance alert and the daily caps.
 * One row per organisation, created on first save; absent means "nothing set".
 * The worker reads these when it evaluates the low balance alert
 * (`shouldAlertLowBalance` in packages/core) and the caps before each send.
 */
export const organisationSettings = pgTable("organisation_settings", {
  organisationId: uuid("organisation_id")
    .primaryKey()
    .references(() => organisations.id, { onDelete: "cascade" }),
  /** Alert when the balance drops below this many micro-EUR; null disables the alert. */
  lowBalanceThresholdMicro: bigint("low_balance_threshold_micro", { mode: "bigint" }),
  /** Up to five recipients of the alert. */
  lowBalanceEmails: text("low_balance_emails").array().notNull().default([]),
  /** When the current dip was alerted; cleared once the balance recovers (rearm). */
  lowBalanceAlertedAt: timestamp("low_balance_alerted_at", { withTimezone: true }),
  /** Messages the organisation may send per calendar day; null means unlimited. */
  dailyMessageCap: integer("daily_message_cap"),
  /** Micro-EUR the organisation may spend per calendar day; null means unlimited. */
  dailySpendCapMicro: bigint("daily_spend_cap_micro", { mode: "bigint" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
