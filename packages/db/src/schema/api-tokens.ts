import type { ApiTokenScope } from "@sendex/core";
import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { organisations, users } from "./core.js";

/**
 * Bearer tokens of the public API (D3-17). Only the SHA-256 of the token is stored; the
 * plaintext is shown once at creation. `prefix` (`sdx_` plus eight characters) is what the
 * settings page lists so an owner can tell tokens apart. A revoked token keeps its row for
 * the audit trail but no longer authenticates.
 */
export const apiTokens = pgTable(
  "api_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    prefix: text("prefix").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    scopes: text("scopes").array().notNull().$type<ApiTokenScope[]>(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [index("api_tokens_org_created_idx").on(t.organisationId, t.createdAt)],
);
