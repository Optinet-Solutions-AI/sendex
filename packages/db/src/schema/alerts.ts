import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { organisations, users } from "./core.js";

/**
 * Alerts raised by the worker for an organisation (D3-11): a daily cap reached, a sending
 * spike, a low balance. One row per (organisation, kind, period_key) so a check that runs
 * every few minutes can raise the same alert any number of times and store it once. The
 * dashboard shows the unacknowledged ones as a banner; email delivery is a later card.
 * `kind` is one of `ALERT_KINDS` in packages/core (validated at the boundary, not an enum,
 * so a new kind needs no migration).
 */
export const organisationAlerts = pgTable(
  "organisation_alerts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    /** UTC day ("2026-11-06") for the caps, UTC hour ("2026-11-06T13") for spike and low balance. */
    periodKey: text("period_key").notNull(),
    /** One sentence for the banner; never a phone number. */
    message: text("message").notNull(),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
    raisedAt: timestamp("raised_at", { withTimezone: true }).notNull().defaultNow(),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    acknowledgedBy: uuid("acknowledged_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    uniqueIndex("organisation_alerts_period_idx").on(t.organisationId, t.kind, t.periodKey),
    index("organisation_alerts_open_idx").on(t.organisationId, t.acknowledgedAt),
  ],
);
