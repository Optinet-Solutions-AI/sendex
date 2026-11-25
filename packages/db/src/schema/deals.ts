import { sql } from "drizzle-orm";
import { bigint, date, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { organisations } from "./core.js";

/**
 * What a brand pays per first deposit (D5-16), uploaded from the Media Deals export. One row
 * per affiliate program, brand and start day; the price in force on a day is the row with the
 * latest `starts_on` on or before it, so earlier deposits keep the earlier price. Only the
 * program, brands, deal text and top geos are stored: never the export's contacts or logins.
 */
export const brandDeals = pgTable(
  "brand_deals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    /** `dealKey(program, brand)` from `@sendex/core`. */
    dealKey: text("deal_key").notNull(),
    program: text("program").notNull(),
    brand: text("brand").notNull(),
    /** The deal as written in Media Deals, e.g. "€200 CPA + 40% rev". */
    deal: text("deal").notNull(),
    topGeos: text("top_geos").notNull().default(""),
    /** Micro-EUR per first deposit; null when the deal has no euro CPA (see `reason`). */
    cpaMicro: bigint("cpa_micro", { mode: "bigint" }),
    reason: text("reason"),
    startsOn: date("starts_on").notNull(),
    uploadedBy: text("uploaded_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    uniqueIndex("brand_deals_org_key_starts_idx").on(t.organisationId, t.dealKey, t.startsOn),
  ],
);
