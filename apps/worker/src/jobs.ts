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
});
export type Click = z.infer<typeof clickSchema>;

export const clickIngestJobSchema = z.object({
  clicks: z.array(clickSchema).min(1),
});
export type ClickIngestJob = z.infer<typeof clickIngestJobSchema>;

export const postbackEventTypeSchema = z.enum(["registration", "sale"]);
export type PostbackEventType = z.infer<typeof postbackEventTypeSchema>;

export const postbackIngestJobSchema = z.object({
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

export const scheduledSendJobSchema = z.object({
  organisationId: nonEmpty,
  campaignId: nonEmpty,
});
export type ScheduledSendJob = z.infer<typeof scheduledSendJobSchema>;

export const jobSchemas = {
  send: sendLapJobSchema,
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
