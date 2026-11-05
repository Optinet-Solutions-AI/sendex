import type { PostbackType } from "@sendex/core";
import { attributePostback, type Db, insertPostback } from "@sendex/db";
import { z } from "zod";
import {
  type PostbackEventType,
  type PostbackIngestJob,
  postbackIngestJobSchema,
} from "../jobs.js";
import { log as defaultLog, type Logger } from "../log.js";
import type { JobMeta } from "../queues.js";

/**
 * The postback-ingest job as the postback endpoint enqueues it: the queue's payload plus
 * the organisation the event belongs to (the signature was checked against its secret).
 * Wiring note: `postbackIngestJobSchema` in jobs.ts must carry `organisationId` too, or the
 * processor strips it before the handler runs and the job fails as unrecoverable.
 */
export const postbackIngestPayloadSchema = postbackIngestJobSchema.extend({
  organisationId: z.uuid(),
});
export type PostbackIngestPayload = z.infer<typeof postbackIngestPayloadSchema>;

/** Queue event types are the tracker's words; the postbacks table stores lead | sale. */
export function toPostbackType(type: PostbackEventType): PostbackType {
  return type === "sale" ? "sale" : "lead";
}

export function toJobEventType(type: PostbackType): PostbackEventType {
  return type === "sale" ? "sale" : "registration";
}

export interface PostbackIngestResult {
  inserted: boolean;
  attributed: boolean;
  /** Null when no message of the organisation carried the dynamic id. */
  messageId: string | null;
}

/**
 * Store the event and attribute it to the message that carried its dynamic id. Both steps
 * are idempotent, so a retried job (or a tracker that re-sends) never counts twice: the
 * insert is a no-op on a known event key and attribution skips an attributed row.
 */
export async function ingestPostback(
  db: Db,
  payload: PostbackIngestPayload,
): Promise<PostbackIngestResult> {
  const { inserted, postback } = await insertPostback(db, payload.organisationId, {
    eventKey: payload.eventKey,
    type: toPostbackType(payload.type),
    dynamicId: payload.dynamicId,
    valueMicro: payload.valueMicro ?? null,
    params: payload.params,
  });
  const { attributed, postback: current } = await attributePostback(db, postback);
  return { inserted, attributed, messageId: current.messageId };
}

/**
 * The `postbackIngest` job handler: wire as `handlers.postbackIngest`. Unknown dynamic ids
 * are kept unattributed (the log page still shows them) and logged as a warning.
 */
export function createPostbackIngestHandler(db: Db, log: Logger = defaultLog) {
  return async (job: PostbackIngestJob, meta?: JobMeta): Promise<void> => {
    const parsed = postbackIngestPayloadSchema.safeParse(job);
    if (!parsed.success) {
      throw new Error(
        `postbackIngest job is missing organisationId (add it to postbackIngestJobSchema): ${z.prettifyError(parsed.error)}`,
      );
    }
    const payload = parsed.data;
    const result = await ingestPostback(db, payload);
    const fields = {
      jobId: meta?.id,
      organisationId: payload.organisationId,
      eventKey: payload.eventKey,
      type: toPostbackType(payload.type),
      ...result,
    };
    if (result.messageId === null) {
      log("warn", "postback not attributed", { ...fields, dynamicId: payload.dynamicId });
    } else {
      log("info", "postback ingested", fields);
    }
  };
}
