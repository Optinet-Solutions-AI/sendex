import {
  bigint,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { organisations } from "./core.js";

export const ledgerKindEnum = pgEnum("ledger_kind", ["deposit", "debit", "refund", "adjustment"]);

/**
 * Append-only money ledger. The balance of an organisation is the sum of its
 * `amount_micro` (see queries/ledger.ts); there is no balance column anywhere.
 * Debits are negative, deposits and refunds positive, adjustments either.
 * Every send writes its debit in the same transaction as the message, keyed by
 * `idempotency_key` so a retry cannot charge twice.
 */
export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    kind: ledgerKindEnum("kind").notNull(),
    /** Signed micro-EUR (1 EUR = 1_000_000). */
    amountMicro: bigint("amount_micro", { mode: "bigint" }).notNull(),
    /** What the entry refers to: message, lap, campaign, invoice, manual. */
    referenceType: text("reference_type"),
    referenceId: text("reference_id"),
    idempotencyKey: text("idempotency_key").notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("ledger_entries_idempotency_key_idx").on(t.idempotencyKey),
    index("ledger_entries_org_created_idx").on(t.organisationId, t.createdAt),
  ],
);
