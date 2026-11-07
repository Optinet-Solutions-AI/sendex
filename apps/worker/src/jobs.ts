import { z } from "zod";
import { QUEUES, type QueueKey } from "./queues.js";

/**
 * Payload schemas for every queue. Validated at the boundary: the processor parses
 * `job.data` with the queue's schema before any handler runs (AGENTS.md rule 5).
 */

const nonEmpty = z.string().min(1);

export const sendLapJobSchema = z.object({
  organisationId: nonEmpty,
  campaignId: nonEmpty,
  lapId: nonEmpty,
  /** Protects the ledger debit and the carrier submit from double processing. */
  idempotencyKey: nonEmpty,
});
export type SendLapJob = z.infer<typeof sendLapJobSchema>;

export const dlrJobSchema = z.object({
  /** Registry name of the provider whose receipt this is; it parses `raw`. */
  provider: nonEmpty,
  raw: z.unknown(),
});
export type DlrJob = z.infer<typeof dlrJobSchema>;

export const clickSchema = z.object({
  shortCode: nonEmpty,
  clickedAt: z.iso.datetime(),
  ip: nonEmpty,
  userAgent: z.string(),
  country: z.string().optional(),
  device: z.string().optional(),
  asn: z.string().optional(),
});
export type Click = z.infer<typeof clickSchema>;

export const clickIngestJobSchema = z.object({
  clicks: z.array(clickSchema).min(1),
});
export type ClickIngestJob = z.infer<typeof clickIngestJobSchema>;

export const postbackEventTypeSchema = z.enum(["registration", "sale"]);
export type PostbackEventType = z.infer<typeof postbackEventTypeSchema>;

export const postbackIngestJobSchema = z.object({
  /** The organisation whose postback key signed the event; attribution is scoped to it. */
  organisationId: nonEmpty,
  /** Unique per event; replays with the same key are ignored downstream. */
  eventKey: nonEmpty,
  type: postbackEventTypeSchema,
  /** The dynamic id carried through the tracked link that ties the event to a contact. */
  dynamicId: nonEmpty,
  /** Sale value in micro-units of the organisation currency (1 EUR = 1_000_000). */
  valueMicro: z.number().int().nonnegative().optional(),
  params: z.record(z.string(), z.string()),
});
export type PostbackIngestJob = z.infer<typeof postbackIngestJobSchema>;

/**
 * The lap dispatcher tick (D2-04): a repeatable job that claims every dispatchable
 * `queued` lap and enqueues its `SendLapJob`. Carries no ids: the dispatcher reads the
 * laps table, so scheduled campaigns need no job of their own.
 */
export const scheduledSendJobSchema = z.object({
  kind: z.literal("dispatch-laps"),
});
export type ScheduledSendJob = z.infer<typeof scheduledSendJobSchema>;

/** One Send Single / Test SMS run (D4-06); `slotKey` names the schedule slot it fires for. */
export const smsTestJobSchema = z.object({
  organisationId: nonEmpty,
  testId: nonEmpty,
  slotKey: z.string().nullable(),
});
export type SmsTestJob = z.infer<typeof smsTestJobSchema>;

export const jobSchemas = {
  send: sendLapJobSchema,
  smsTests: smsTestJobSchema,
  dlr: dlrJobSchema,
  clickIngest: clickIngestJobSchema,
  postbackIngest: postbackIngestJobSchema,
  scheduledSend: scheduledSendJobSchema,
} as const satisfies Record<QueueKey, z.ZodType>;

export type JobPayloads = { [K in QueueKey]: z.infer<(typeof jobSchemas)[K]> };

/** Parse a payload for the given queue, or throw an error that names the queue. */
export function parseJob<K extends QueueKey>(queue: K, data: unknown): JobPayloads[K] {
  const result = jobSchemas[queue].safeParse(data);
  if (!result.success) {
    throw new Error(`Invalid "${QUEUES[queue]}" job payload: ${z.prettifyError(result.error)}`);
  }
  return result.data as JobPayloads[K];
}

export const parseSendLapJob = (data: unknown): SendLapJob => parseJob("send", data);
export const parseDlrJob = (data: unknown): DlrJob => parseJob("dlr", data);
export const parseClickIngestJob = (data: unknown): ClickIngestJob => parseJob("clickIngest", data);
export const parsePostbackIngestJob = (data: unknown): PostbackIngestJob =>
  parseJob("postbackIngest", data);
export const parseScheduledSendJob = (data: unknown): ScheduledSendJob =>
  parseJob("scheduledSend", data);
