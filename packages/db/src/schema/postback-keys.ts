import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { organisations } from "./core.js";

/**
 * The secret an organisation's brand signs its postbacks with (HMAC-SHA256 over the
 * query, see packages/core/postbacks.ts). One row per organisation, created on first
 * read and replaced by "Rotate secret" in settings; the old secret stops working at once.
 */
export const organisationPostbackKeys = pgTable("organisation_postback_keys", {
  organisationId: uuid("organisation_id")
    .primaryKey()
    .references(() => organisations.id, { onDelete: "cascade" }),
  secret: text("secret").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  rotatedAt: timestamp("rotated_at", { withTimezone: true }),
});
