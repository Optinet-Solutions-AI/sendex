import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  char,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { organisations, users } from "./core.js";
import { lists } from "./lists.js";
import { routes } from "./routes.js";

export const campaignStatusEnum = pgEnum("campaign_status", [
  "draft",
  "scheduled",
  "sending",
  "paused",
  "stopped",
  "completed",
]);

/**
 * account_wide: a contact already messaged by any campaign of the organisation is skipped.
 * per_campaign: only contacts already messaged by this campaign are skipped.
 */
export const contactReuseEnum = pgEnum("contact_reuse", ["account_wide", "per_campaign"]);

export const lapStatusEnum = pgEnum("lap_status", ["queued", "sending", "done", "cancelled"]);

export const campaigns = pgTable("campaigns", {
  id: uuid("id").primaryKey().defaultRandom(),
  organisationId: uuid("organisation_id")
    .notNull()
    .references(() => organisations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  country: char("country", { length: 2 }).notNull(),
  /** IANA zone used for scheduling and reporting, e.g. Europe/Madrid. */
  timezone: text("timezone").notNull(),
  status: campaignStatusEnum("status").notNull().default("draft"),
  contactReuse: contactReuseEnum("contact_reuse").notNull().default("account_wide"),
  /** Numbers per test lap before a route is ranked. */
  testSize: integer("test_size").notNull().default(200),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** A named pool of sender ids for one country; a campaign rotates through its active members. */
export const sidGroups = pgTable("sid_groups", {
  id: uuid("id").primaryKey().defaultRandom(),
  organisationId: uuid("organisation_id")
    .notNull()
    .references(() => organisations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  country: char("country", { length: 2 }).notNull(),
  active: boolean("active").notNull().default(true),
});

export const senderIds = pgTable(
  "sender_ids",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    sidGroupId: uuid("sid_group_id")
      .notNull()
      .references(() => sidGroups.id, { onDelete: "cascade" }),
    /** Alphanumeric sender shown on the handset, e.g. LUCKY777 (max 11 chars on most carriers). */
    value: text("value").notNull(),
    active: boolean("active").notNull().default(true),
  },
  (t) => [uniqueIndex("sender_ids_group_value_idx").on(t.sidGroupId, t.value)],
);

/**
 * A tracked destination. `url` may contain placeholders such as `{{dynamic}}`
 * that the link service fills from the message when it redirects a click.
 */
export const links = pgTable("links", {
  id: uuid("id").primaryKey().defaultRandom(),
  organisationId: uuid("organisation_id")
    .notNull()
    .references(() => organisations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  url: text("url").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** One of the message texts of a campaign; the sender rotates through active texts by position. */
export const adTexts = pgTable(
  "ad_texts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    /** GSM_7BIT or UCS2, from packages/core analyseSmsText. */
    encoding: text("encoding").notNull(),
    parts: integer("parts").notNull().default(1),
    active: boolean("active").notNull().default(true),
    position: integer("position").notNull().default(0),
  },
  (t) => [index("ad_texts_campaign_position_idx").on(t.campaignId, t.position)],
);

export const campaignLists = pgTable(
  "campaign_lists",
  {
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    listId: uuid("list_id")
      .notNull()
      .references(() => lists.id, { onDelete: "cascade" }),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.campaignId, t.listId] })],
);

/** A campaign sends from exactly one sender id group. */
export const campaignSidGroup = pgTable("campaign_sid_group", {
  campaignId: uuid("campaign_id")
    .primaryKey()
    .references(() => campaigns.id, { onDelete: "cascade" }),
  sidGroupId: uuid("sid_group_id")
    .notNull()
    .references(() => sidGroups.id, { onDelete: "restrict" }),
  organisationId: uuid("organisation_id")
    .notNull()
    .references(() => organisations.id, { onDelete: "cascade" }),
});

export const campaignLinks = pgTable(
  "campaign_links",
  {
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    linkId: uuid("link_id")
      .notNull()
      .references(() => links.id, { onDelete: "cascade" }),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    active: boolean("active").notNull().default(true),
  },
  (t) => [primaryKey({ columns: [t.campaignId, t.linkId] })],
);

/**
 * One send pass of a campaign over one list through one route. Test laps send
 * `test_size` numbers per route; the ranked best route then gets the main lap.
 * Counters are denormalised from messages / clicks / postbacks for the dashboard.
 */
export const laps = pgTable(
  "laps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    listId: uuid("list_id")
      .notNull()
      .references(() => lists.id, { onDelete: "restrict" }),
    routeId: uuid("route_id")
      .notNull()
      .references(() => routes.id, { onDelete: "restrict" }),
    testSize: integer("test_size").notNull(),
    status: lapStatusEnum("status").notNull().default("queued"),
    sent: integer("sent").notNull().default(0),
    delivered: integer("delivered").notNull().default(0),
    failed: integer("failed").notNull().default(0),
    clicks: integer("clicks").notNull().default(0),
    leads: integer("leads").notNull().default(0),
    sales: integer("sales").notNull().default(0),
    /** Micro-EUR debited for this lap so far. */
    costMicro: bigint("cost_micro", { mode: "bigint" }).notNull().default(sql`0`),
    /** 1 = best route of the test round; null until ranked. */
    rank: integer("rank"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("laps_campaign_idx").on(t.campaignId, t.status)],
);
