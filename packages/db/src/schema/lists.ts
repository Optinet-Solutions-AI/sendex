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
 * One row per phone number per organisation. A contact can sit in many lists
 * (`list_members`); the number itself is stored once so account-wide contact
 * reuse ("do not send to a number twice across campaigns") can be enforced.
 */
export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    /** E.164 with leading plus, e.g. +34600123456. */
    e164: text("e164").notNull(),
    /** ISO 3166-1 alpha-2, derived from the number's country code. */
    country: char("country", { length: 2 }).notNull(),
    firstName: text("first_name"),
    lastName: text("last_name"),
    email: text("email"),
    custom1: text("custom1"),
    custom2: text("custom2"),
    custom3: text("custom3"),
    custom4: text("custom4"),
    custom5: text("custom5"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("contacts_org_e164_idx").on(t.organisationId, t.e164)],
);

/** An uploaded list, e.g. `Roy Boy_ES_14092026_Batch2`. One country per list. */
export const lists = pgTable("lists", {
  id: uuid("id").primaryKey().defaultRandom(),
  organisationId: uuid("organisation_id")
    .notNull()
    .references(() => organisations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  country: char("country", { length: 2 }).notNull(),
  /** Denormalised member count, maintained by the upload and flush helpers. */
  numbersCount: integer("numbers_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastUploadAt: timestamp("last_upload_at", { withTimezone: true }),
  lastSentAt: timestamp("last_sent_at", { withTimezone: true }),
  /** Archived lists are hidden from the table and the campaign pickers; members stay. */
  archivedAt: timestamp("archived_at", { withTimezone: true }),
});

/**
 * Membership of a contact in a list. `sent_at` records the last campaign send to
 * this member; `flushed_at` marks members removed by a flush (kept for history);
 * `bad` marks numbers rejected by a carrier or failed validation.
 */
export const listMembers = pgTable(
  "list_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    listId: uuid("list_id")
      .notNull()
      .references(() => lists.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    flushedAt: timestamp("flushed_at", { withTimezone: true }),
    bad: boolean("bad").notNull().default(false),
    badReason: text("bad_reason"),
  },
  (t) => [
    uniqueIndex("list_members_list_contact_idx").on(t.listId, t.contactId),
    index("list_members_list_sent_idx").on(t.listId, t.sentAt),
    index("list_members_contact_idx").on(t.contactId),
  ],
);

/**
 * Numbers that must never be messaged by this organisation: opt-outs, complaints,
 * carrier blocks. Checked by the lap planner before anything is queued.
 */
export const suppressions = pgTable(
  "suppressions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    e164: text("e164").notNull(),
    /** ISO-2 of the number when known. */
    country: char("country", { length: 2 }),
    /** e.g. unsubscribe, complaint, invalid, manual */
    reason: text("reason").notNull(),
    /** Where it came from: manual (Add number), upload, api, sms (STOP reply), provider */
    source: text("source").notNull(),
    /** The suppression file it came from, when uploaded. */
    importId: uuid("import_id").references(() => suppressionImports.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("suppressions_org_e164_idx").on(t.organisationId, t.e164)],
);

/** One uploaded suppression file ("Imported lists" on the Unsubscribe page). */
export const suppressionImports = pgTable("suppression_imports", {
  id: uuid("id").primaryKey().defaultRandom(),
  organisationId: uuid("organisation_id")
    .notNull()
    .references(() => organisations.id, { onDelete: "cascade" }),
  fileName: text("file_name").notNull(),
  /** Numbers the file added to the suppression list. */
  count: integer("count").notNull().default(0),
  /** Rows that did not parse as an international number. */
  rejected: integer("rejected").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * One upload of a file (or pasted numbers) into a list: the counts the Files page and the
 * list's Data Files tab show, plus the full summary (reasons and sample numbers) as JSON.
 */
export const listImports = pgTable(
  "list_imports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    listId: uuid("list_id")
      .notNull()
      .references(() => lists.id, { onDelete: "cascade" }),
    fileName: text("file_name").notNull(),
    /** `file` or `paste`. */
    source: text("source").notNull().default("file"),
    /** `done` or `failed`. */
    status: text("status").notNull().default("done"),
    rowsInFile: integer("rows_in_file").notNull().default(0),
    /** Rows with a number that parsed (added, skipped or duplicate). */
    valid: integer("valid").notNull().default(0),
    added: integer("added").notNull().default(0),
    addedGood: integer("added_good").notNull().default(0),
    addedBad: integer("added_bad").notNull().default(0),
    rejected: integer("rejected").notNull().default(0),
    skipped: integer("skipped").notNull().default(0),
    duplicates: integer("duplicates").notNull().default(0),
    /** Whether numbers already in the organisation were skipped. */
    dedup: boolean("dedup").notNull().default(true),
    summary: jsonb("summary").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("list_imports_list_idx").on(t.listId, t.createdAt)],
);

// ---------------------------------------------------------------------------
// Numbers Verification (D4-07): lookup results, enrichment rules and the verification log.
// ---------------------------------------------------------------------------

/**
 * The last network lookup of a number for an organisation (the "cache"). `status` is one of
 * hlr, mnp, unresolved, local_only, checking, bad, blacklisted (packages/core LOOKUP_STATUSES).
 */
export const lookupResults = pgTable(
  "lookup_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    e164: text("e164").notNull(),
    country: char("country", { length: 2 }).notNull(),
    status: text("status").notNull(),
    /** hlr, mnp or format. */
    method: text("method").notNull(),
    operator: text("operator"),
    ported: boolean("ported").notNull().default(false),
    priceMicro: bigint("price_micro", { mode: "bigint" }).notNull().default(sql`0`),
    provider: text("provider").notNull(),
    requestId: uuid("request_id"),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("lookup_results_org_e164_idx").on(t.organisationId, t.e164),
    index("lookup_results_org_country_idx").on(t.organisationId, t.country),
  ],
);

/** An enrichment rule: verify a country's new numbers automatically within limits. */
export const enrichmentRules = pgTable(
  "enrichment_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    country: char("country", { length: 2 }).notNull(),
    dailyLimit: integer("daily_limit").notNull().default(5000),
    monthlyBudgetMicro: bigint("monthly_budget_micro", { mode: "bigint" })
      .notNull()
      .default(sql`25000000`),
    onSchedule: boolean("on_schedule").notNull().default(true),
    afterUpload: boolean("after_upload").notNull().default(false),
    asYouSend: boolean("as_you_send").notNull().default(false),
    includeArchived: boolean("include_archived").notNull().default(false),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("enrichment_rules_org_country_idx").on(t.organisationId, t.country)],
);

/**
 * One verification run (the Verification log): what was asked, by which trigger, and the
 * verdicts once the worker finished. `status` is queued, running, done or failed.
 */
export const verificationRequests = pgTable(
  "verification_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    country: char("country", { length: 2 }).notNull(),
    /** rule, hlr_verify, upload or send. */
    source: text("source").notNull(),
    listId: uuid("list_id").references(() => lists.id, { onDelete: "set null" }),
    ruleId: uuid("rule_id").references(() => enrichmentRules.id, { onDelete: "set null" }),
    /** How many numbers the request may verify at most. */
    limit: integer("limit").notNull(),
    total: integer("total").notNull().default(0),
    good: integer("good").notNull().default(0),
    bad: integer("bad").notNull().default(0),
    noVerdict: integer("no_verdict").notNull().default(0),
    costMicro: bigint("cost_micro", { mode: "bigint" }).notNull().default(sql`0`),
    status: text("status").notNull().default("queued"),
    requestedBy: uuid("requested_by").references(() => users.id, { onDelete: "set null" }),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("verification_requests_org_at_idx").on(t.organisationId, t.requestedAt)],
);

/** The lookup price per number and country (platform table): route name, method, price. */
export const lookupPrices = pgTable(
  "lookup_prices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    country: char("country", { length: 2 }).notNull(),
    route: text("route").notNull(),
    /** hlr or mnp. */
    method: text("method").notNull(),
    priceMicro: bigint("price_micro", { mode: "bigint" }).notNull(),
    validFrom: timestamp("valid_from", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("lookup_prices_country_valid_idx").on(t.country, t.validFrom)],
);
