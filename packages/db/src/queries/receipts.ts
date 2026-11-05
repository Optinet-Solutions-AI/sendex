import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { laps } from "../schema/campaigns.js";
import { routes } from "../schema/routes.js";
import { messages } from "../schema/tracking.js";
import type { Db } from "../types.js";

/**
 * Delivery receipts and expiry (D3-01). A message the carrier accepted is `sent` until a
 * receipt says `delivered`, `failed` or `expired`, or until no receipt has arrived for
 * `expireStaleMessages`'s window, after which it is `expired` with error code `NO_RECEIPT`.
 *
 * Status rules:
 * - Only a `sent` message takes a receipt. `delivered`, `failed`, `expired` and `cancelled`
 *   are final: a second receipt for the same message, a `failed` after a `delivered`, or a
 *   late `delivered` after the message expired are all ignored, so the lap counters never
 *   move twice for one message.
 * - `laps.delivered` counts delivered receipts. `laps.failed` counts every message that will
 *   never be delivered: rejected at submit (send loop), carrier `UNDELIV`/`REJECTD`/...,
 *   carrier `EXPIRED`, and expiry here. There is no separate expired counter; delivery rate
 *   is `delivered / sent` and `sent - delivered - failed` is still pending.
 * - `laps.sent` is untouched by receipts: it counts what the carrier accepted.
 */

export type ReceiptStatus = "delivered" | "failed" | "expired";

export interface ParsedReceipt {
  providerMessageId: string;
  status: ReceiptStatus;
  errorCode?: string | undefined;
  /** When the carrier says the final state was reached. */
  at: Date;
}

export interface ApplyReceiptInput {
  /** Registry name of the provider the receipt came from (`routes.provider`). */
  provider: string;
  receipt: ParsedReceipt;
  /** When given, only a message of this organisation can match. */
  organisationId?: string | undefined;
}

export interface ReceiptTarget {
  messageId: string;
  organisationId: string;
  campaignId: string;
  lapId: string;
}

export type ApplyReceiptResult =
  | ({ outcome: "applied"; status: ReceiptStatus } & ReceiptTarget)
  /** The message is already in a final state; nothing changed. */
  | ({ outcome: "ignored"; status: string } & ReceiptTarget)
  /** No message of this provider carries that id (yet). */
  | { outcome: "unknown" };

/**
 * Apply a parsed receipt to the message with that provider message id on a route of that
 * provider, and bump the lap's `delivered` or `failed` in the same transaction. Idempotent
 * per message (see the status rules above).
 */
export async function applyDeliveryReceipt(
  db: Db,
  input: ApplyReceiptInput,
): Promise<ApplyReceiptResult> {
  const { receipt } = input;
  return db.transaction(async (tx) => {
    const [found] = await tx
      .select({
        messageId: messages.id,
        organisationId: messages.organisationId,
        campaignId: messages.campaignId,
        lapId: messages.lapId,
        status: messages.status,
      })
      .from(messages)
      .innerJoin(routes, eq(routes.id, messages.routeId))
      .where(
        and(
          eq(messages.providerMessageId, receipt.providerMessageId),
          eq(routes.provider, input.provider),
          input.organisationId === undefined
            ? undefined
            : eq(messages.organisationId, input.organisationId),
        ),
      )
      .limit(1);
    if (!found) return { outcome: "unknown" };
    const target: ReceiptTarget = {
      messageId: found.messageId,
      organisationId: found.organisationId,
      campaignId: found.campaignId,
      lapId: found.lapId,
    };
    if (found.status !== "sent") return { outcome: "ignored", status: found.status, ...target };

    const [updated] = await tx
      .update(messages)
      .set(
        receipt.status === "delivered"
          ? { status: "delivered", deliveredAt: receipt.at }
          : { status: receipt.status, errorCode: receipt.errorCode ?? null },
      )
      .where(and(eq(messages.id, found.messageId), eq(messages.status, "sent")))
      .returning({ id: messages.id });
    // Lost a race with another receipt for the same message: it is final now.
    if (!updated) return { outcome: "ignored", status: "final", ...target };

    await tx
      .update(laps)
      .set(
        receipt.status === "delivered"
          ? { delivered: sql`${laps.delivered} + 1` }
          : { failed: sql`${laps.failed} + 1` },
      )
      .where(eq(laps.id, found.lapId));
    return { outcome: "applied", status: receipt.status, ...target };
  });
}

/** Error code written on messages that expire without a receipt. */
export const NO_RECEIPT_ERROR_CODE = "NO_RECEIPT";

/** Default window after which a `sent` message without receipt is expired: 24 hours. */
export const RECEIPT_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface ExpireStaleOptions {
  /** At most this many messages per call; the caller repeats. Default 10 000. */
  limit?: number;
}

/**
 * Mark `sent` messages accepted before `olderThan` as `expired` (`error_code NO_RECEIPT`)
 * and count them on their laps as failed, in one transaction. Runs across organisations:
 * it is the worker's maintenance tick, not a tenant action. Returns how many expired.
 */
export async function expireStaleMessages(
  db: Db,
  olderThan: Date,
  options: ExpireStaleOptions = {},
): Promise<number> {
  const limit = options.limit ?? 10_000;
  return db.transaction(async (tx) => {
    const stale = tx
      .select({ id: messages.id })
      .from(messages)
      .where(
        and(
          eq(messages.status, "sent"),
          // Explicit cast: postgres-js cannot type a Date compared with a raw expression and
          // sends it as text, which PGlite accepts and Postgres 17 rejects.
          lt(
            sql`coalesce(${messages.sentAt}, ${messages.createdAt})`,
            sql`${olderThan.toISOString()}::timestamptz`,
          ),
        ),
      )
      .limit(limit);
    const expired = await tx
      .update(messages)
      .set({ status: "expired", errorCode: NO_RECEIPT_ERROR_CODE })
      .where(and(eq(messages.status, "sent"), inArray(messages.id, stale)))
      .returning({ lapId: messages.lapId });
    const perLap = new Map<string, number>();
    for (const row of expired) perLap.set(row.lapId, (perLap.get(row.lapId) ?? 0) + 1);
    for (const [lapId, count] of perLap) {
      await tx
        .update(laps)
        .set({ failed: sql`${laps.failed} + ${count}` })
        .where(eq(laps.id, lapId));
    }
    return expired.length;
  });
}
