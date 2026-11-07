import { sql } from "drizzle-orm";
import {
  bigint,
  char,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { adTexts, campaigns, laps, links } from "./campaigns.js";
import { organisations } from "./core.js";
import { contacts } from "./lists.js";
import { routes, smsTests } from "./routes.js";

export const messageStatusEnum = pgEnum("message_status", [
  "queued",
  "sent",
  "delivered",
  "failed",
  "expired",
  "cancelled",
]);

export const postbackTypeEnum = pgEnum("postback_type", ["lead", "sale"]);

/**
 * One SMS to one number. The worker inserts it with its ledger debit in the
 * same transaction, keyed by `idempotency_key` (lap + contact) so a retried
 * job cannot send or charge twice.
 *
 * TODO(chore/partition-messages): partition by month on `created_at`. Drizzle
 * does not model partitions, so the follow-up to D1-12 adds a hand-written
 * migration that recreates `messages` (and `clicks`) as partitioned tables and
 * widens the primary key to (id, created_at). Until then this is a plain table.
 */
export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    /** Null for a Send Single / Test SMS message (D4-06), which belongs to `test_id` instead. */
    campaignId: uuid("campaign_id").references(() => campaigns.id, { onDelete: "cascade" }),
    lapId: uuid("lap_id").references(() => laps.id, { onDelete: "cascade" }),
    testId: uuid("test_id").references(() => smsTests.id, { onDelete: "cascade" }),
    /** Null for a test message to a number that is not a contact. */
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "restrict" }),
    e164: text("e164").notNull(),
    /** Mobile operator, from the carrier receipt or the first click that resolved it. */
    operator: text("operator"),
    /** The sender id value used for this message. */
    senderId: text("sender_id").notNull(),
    /** Final text after link and placeholder substitution. */
    text: text("text").notNull(),
    encoding: text("encoding").notNull(),
    parts: integer("parts").notNull().default(1),
    routeId: uuid("route_id")
      .notNull()
      .references(() => routes.id, { onDelete: "restrict" }),
    status: messageStatusEnum("status").notNull().default("queued"),
    providerMessageId: text("provider_message_id"),
    errorCode: text("error_code"),
    /** Short link code embedded in the text, resolved by apps/links. */
    shortCode: text("short_code"),
    /** Value substituted for {{dynamic}} in the tracked link; echoed back by postbacks. */
    dynamicId: text("dynamic_id"),
    /** The ad text the message was rendered from, for per-text conversion stats. */
    adTextId: uuid("ad_text_id").references(() => adTexts.id, { onDelete: "set null" }),
    /** The tracked link embedded in the text, when the campaign had one. */
    linkId: uuid("link_id").references(() => links.id, { onDelete: "set null" }),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("messages_idempotency_key_idx").on(t.idempotencyKey),
    index("messages_lap_status_idx").on(t.lapId, t.status),
    index("messages_org_created_idx").on(t.organisationId, t.createdAt),
    index("messages_short_code_idx").on(t.shortCode),
    index("messages_dynamic_id_idx").on(t.dynamicId),
    /** Delivery receipts look a message up by the carrier's id (D3-01). */
    index("messages_provider_message_id_idx").on(t.providerMessageId),
    /** The expiry tick scans `sent` messages by age; nothing else needs this (D3-01). */
    index("messages_sent_pending_receipt_idx").on(t.sentAt).where(sql`"status" = 'sent'`),
    /** The Campaigns Log and Send Calendar window messages by sent_at (D4-05). */
    index("messages_org_sent_idx").on(t.organisationId, t.sentAt),
  ],
);

/**
 * A redirect served by apps/links. Written by the link worker; the lap counter
 * is updated from it.
 *
 * TODO(chore/partition-messages): partition by month together with messages.
 */
export const clicks = pgTable(
  "clicks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    messageId: uuid("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    lapId: uuid("lap_id")
      .notNull()
      .references(() => laps.id, { onDelete: "cascade" }),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    ip: text("ip"),
    country: char("country", { length: 2 }),
    userAgent: text("user_agent"),
    /** mobile, desktop, tablet, bot */
    device: text("device"),
    /** Mobile operator when the IP resolves to one. */
    operator: text("operator"),
  },
  (t) => [index("clicks_lap_idx").on(t.lapId), index("clicks_message_idx").on(t.messageId)],
);

/**
 * A conversion reported by the advertiser's tracker (lead or sale). `event_key`
 * is the tracker's unique event id so a re-sent postback is ignored. The
 * message / campaign / lap columns are filled when `dynamic_id` is matched.
 */
export const postbacks = pgTable(
  "postbacks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    eventKey: text("event_key").notNull(),
    type: postbackTypeEnum("type").notNull(),
    dynamicId: text("dynamic_id").notNull(),
    messageId: uuid("message_id").references(() => messages.id, { onDelete: "set null" }),
    campaignId: uuid("campaign_id").references(() => campaigns.id, { onDelete: "set null" }),
    lapId: uuid("lap_id").references(() => laps.id, { onDelete: "set null" }),
    /** Sale value in micro-EUR when the tracker reports one. */
    valueMicro: bigint("value_micro", { mode: "bigint" }),
    /** Raw query parameters as received. */
    params: jsonb("params").$type<Record<string, unknown>>().notNull().default({}),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("postbacks_event_key_idx").on(t.eventKey),
    index("postbacks_dynamic_id_idx").on(t.dynamicId),
    index("postbacks_org_received_idx").on(t.organisationId, t.receivedAt),
    index("postbacks_campaign_idx").on(t.campaignId),
    /** Per-message conversion counts in the send log (D4-05). */
    index("postbacks_message_idx").on(t.messageId),
  ],
);
