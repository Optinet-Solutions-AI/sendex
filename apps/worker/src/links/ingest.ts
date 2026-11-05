import { classifyDevice } from "@sendex/core";
import { type Db, findMessagesByShortCodes, type NewClick, recordClicks } from "@sendex/db";
import { z } from "zod";
import { clickSchema } from "../jobs.js";
import { log as defaultLog, type Logger } from "../log.js";

/**
 * A click as the links service sends it: the queue's `Click` plus what the edge adds.
 * The extras are optional so a plain `ClickIngestJob` still ingests (device is then
 * classified here, country and operator stay null).
 */
export const ingestClickSchema = clickSchema.extend({
  /** ISO 3166-1 alpha-2 from Cloudflare; anything else is stored as null. */
  country: z.string().optional(),
  device: z.string().optional(),
  /** Network name from Cloudflare (`asOrganization`), stored as the operator. */
  asn: z.string().optional(),
});
export type IngestClick = z.infer<typeof ingestClickSchema>;

/** Body of `POST /internal/clicks` and payload of the click-ingest job. */
export const clickBatchSchema = z.object({
  clicks: z.array(ingestClickSchema).min(1).max(1000),
});
export type ClickBatch = z.infer<typeof clickBatchSchema>;

export interface ClickIngestResult {
  inserted: number;
  /** Clicks whose short code matched no message; dropped. */
  unknown: number;
}

const COUNTRY = /^[A-Za-z]{2}$/;

function nullable(value: string | undefined): string | null {
  return value === undefined || value === "" || value === "unknown" ? null : value;
}

function toRow(
  click: IngestClick,
  message: { id: string; organisationId: string; campaignId: string; lapId: string },
): NewClick {
  return {
    organisationId: message.organisationId,
    messageId: message.id,
    campaignId: message.campaignId,
    lapId: message.lapId,
    at: new Date(click.clickedAt),
    ip: nullable(click.ip),
    country:
      click.country !== undefined && COUNTRY.test(click.country)
        ? click.country.toUpperCase()
        : null,
    userAgent: nullable(click.userAgent),
    device: click.device ?? classifyDevice(click.userAgent),
    operator: nullable(click.asn),
  };
}

/**
 * Resolve each click's short code to its message and insert the batch, counting the
 * lap. Unknown codes are dropped: a click on a link we never sent is noise, not an error.
 */
export async function ingestClicks(
  db: Db,
  batch: { clicks: readonly IngestClick[] },
): Promise<ClickIngestResult> {
  const codes = [...new Set(batch.clicks.map((c) => c.shortCode))];
  const messages = await findMessagesByShortCodes(db, codes);
  const byCode = new Map(messages.map((m) => [m.shortCode, m]));

  const rows: NewClick[] = [];
  let unknown = 0;
  for (const click of batch.clicks) {
    const message = byCode.get(click.shortCode);
    if (message === undefined) {
      unknown += 1;
      continue;
    }
    rows.push(toRow(click, message));
  }
  const inserted = await recordClicks(db, rows);
  return { inserted, unknown };
}

/**
 * The `clickIngest` job handler: wire as `handlers.clickIngest`. Logs counts only;
 * click records carry IPs and user agents and never reach the log.
 */
export function createClickIngestHandler(db: Db, log: Logger = defaultLog) {
  return async (job: { clicks: readonly IngestClick[] }): Promise<void> => {
    const result = await ingestClicks(db, job);
    log("info", "clicks ingested", { received: job.clicks.length, ...result });
  };
}
