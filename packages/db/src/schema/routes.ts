import {
  bigint,
  boolean,
  char,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { organisations } from "./core.js";

/**
 * A way to deliver SMS: a rented platform route (SMS Edge style numeric names,
 * `organisation_id` null, visible to every tenant) or a tenant's own custom
 * route (e.g. 23Telecom over SMPP, `organisation_id` set).
 */
export const routes = pgTable("routes", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Null for platform routes shared by every organisation. */
  organisationId: uuid("organisation_id").references(() => organisations.id, {
    onDelete: "cascade",
  }),
  /** Provider adapter key from packages/providers: platform, smpp, http, fake. */
  provider: text("provider").notNull(),
  name: text("name").notNull(),
  /** Primary country the route is sold for; prices per country live in route_prices. */
  country: char("country", { length: 2 }),
  active: boolean("active").notNull().default(true),
  /** Adapter configuration (host, port, system id, ...). Secrets are referenced, not stored. */
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
});

/**
 * Price history per route and destination country, in micro-EUR per message part.
 * The current price is the row with the latest `valid_from` not in the future.
 * Not a tenant table: prices belong to the route.
 */
export const routePrices = pgTable(
  "route_prices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    routeId: uuid("route_id")
      .notNull()
      .references(() => routes.id, { onDelete: "cascade" }),
    country: char("country", { length: 2 }).notNull(),
    /** Micro-EUR (1 EUR = 1_000_000). 0.0357 EUR is 35_700. */
    priceMicro: bigint("price_micro", { mode: "bigint" }).notNull(),
    validFrom: timestamp("valid_from", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("route_prices_route_country_valid_idx").on(t.routeId, t.country, t.validFrom)],
);
