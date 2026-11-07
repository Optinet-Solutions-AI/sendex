import {
  boolean,
  char,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { organisations } from "./core.js";

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
    /** e.g. unsubscribe, complaint, invalid, manual */
    reason: text("reason").notNull(),
    /** Where it came from: sms (STOP reply), ui, import, provider */
    source: text("source").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("suppressions_org_e164_idx").on(t.organisationId, t.e164)],
);
