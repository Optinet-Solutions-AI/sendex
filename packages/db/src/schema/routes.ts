import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  char,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { organisations, users } from "./core.js";

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
  /**
   * Custom-route credentials sealed with `CUSTOM_ROUTE_SECRET_KEY` (AES-256-GCM, see
   * packages/db secrets); opened only in the worker. Null on platform routes.
   */
  secret: text("secret"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** What a Test Connection (or a send) learned about a custom route's carrier. */
export const routeConnectionEvents = pgTable(
  "route_connection_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    routeId: uuid("route_id")
      .notNull()
      .references(() => routes.id, { onDelete: "cascade" }),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    /** bind, bind_failed, probe, probe_failed. */
    event: text("event").notNull(),
    /** test_connection or send. */
    source: text("source").notNull(),
    host: text("host").notNull(),
    latencyMs: integer("latency_ms"),
    error: text("error"),
  },
  (t) => [index("route_connection_events_route_at_idx").on(t.routeId, t.at)],
);

/**
 * Per-country exception to the organisation's routing strategy: an explicit route order,
 * routes switched off for the country, or one route locked in.
 */
export const routingExceptions = pgTable(
  "routing_exceptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    country: char("country", { length: 2 }).notNull(),
    routeOrder: uuid("route_order").array().notNull().default([]),
    disabledRoutes: uuid("disabled_routes").array().notNull().default([]),
    lockedRoute: uuid("locked_route").references(() => routes.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("routing_exceptions_org_country_idx").on(t.organisationId, t.country)],
);

/**
 * A Send Single or Test SMS run (Routes > Testing): what to send, through which routes, to
 * whom, on which schedule, and what happened. `type` is single (a number you control) or
 * test (real test handsets, needs a test-network provider).
 */
export const smsTests = pgTable(
  "sms_tests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    country: char("country", { length: 2 }).notNull(),
    routeIds: uuid("route_ids").array().notNull().default([]),
    /** random_string, random_casino, random_shop, custom. */
    senderModes: text("sender_modes").array().notNull().default([]),
    customSender: text("custom_sender"),
    /** Preset keys from packages/core (generic_ecommerce, ...) plus custom. */
    textPresets: text("text_presets").array().notNull().default([]),
    customText: text("custom_text"),
    /** E.164 for a single send; null for a handset test. */
    recipient: text("recipient"),
    testNetworks: text("test_networks").array().notNull().default([]),
    hypothesis: text("hypothesis"),
    jitter: boolean("jitter").notNull().default(false),
    cascade: boolean("cascade").notNull().default(false),
    /** 1 = Monday ... 7 = Sunday; null means run once, now. */
    scheduleDays: integer("schedule_days").array(),
    /** "HH:MM" UTC in 15-minute steps. */
    scheduleTimes: text("schedule_times").array(),
    /** The last "YYYY-MM-DDTHH:MM" slot the schedule fired for. */
    lastSlot: text("last_slot"),
    testsRan: integer("tests_ran").notNull().default(0),
    successCount: integer("success_count").notNull().default(0),
    costMicro: bigint("cost_micro", { mode: "bigint" }).notNull().default(sql`0`),
    /** queued, scheduled, running, done, failed. */
    queueStatus: text("queue_status").notNull().default("queued"),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSentAt: timestamp("last_sent_at", { withTimezone: true }),
  },
  (t) => [index("sms_tests_org_created_idx").on(t.organisationId, t.createdAt)],
);

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
