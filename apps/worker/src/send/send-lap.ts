import { randomUUID } from "node:crypto";
import { analyseSmsText, renderMessageText } from "@sendex/core";
import type {
  EligibilityInput,
  EligibleMember,
  LapContext,
  MessageOutcome,
  NewMessageInput,
  QueuedMessage,
  SendingStore,
} from "@sendex/db";
import {
  type OutboundMessage,
  type Provider,
  type ProviderRegistry,
  resolveProviderForRoute,
} from "@sendex/providers";
import { UnrecoverableError } from "bullmq";
import type { SendLapJob } from "../jobs.js";
import type { Logger } from "../log.js";
import type { JobMeta } from "../queues.js";
import { type ProgressTracker, progressKeys, type SendRedis } from "./progress.js";
import { generateShortCode } from "./short-code.js";

export const DEFAULT_BATCH_SIZE = 50;
export const DEFAULT_PAUSE_RETRY_MS = 10_000;

export interface SendLapDeps {
  store: SendingStore;
  providers: ProviderRegistry;
  redis: Pick<SendRedis, "get">;
  progress: ProgressTracker;
  log: Logger;
  /** Base of the tracked short links, e.g. https://go.example.com (no trailing slash). */
  linksBaseUrl: string;
  /** Messages per provider submit. Default 50. */
  batchSize?: number;
  /** How long a paused lap waits before it looks at the campaign again. Default 10 s. */
  pauseRetryMs?: number;
  shortCode?: () => string;
  dynamicId?: () => string;
}

export type SendLapOutcome = "done" | "cancelled" | "paused" | "skipped";

export interface SendLapResult {
  outcome: SendLapOutcome;
  /** Messages accepted and failed by this run (not the lap totals). */
  sent: number;
  failed: number;
  reason?: string;
}

type Guard = { kind: "go" } | { kind: "stop"; reason: string } | { kind: "pause" };

/** A sample rendering used to estimate parts before any member is known. */
function estimateMaxParts(ctx: LapContext, linksBaseUrl: string): number {
  const domain = ctx.link ? `${linksBaseUrl}/xxxxxxxx` : null;
  let max = 1;
  for (const t of ctx.texts) {
    const sample = renderMessageText(t.text, { firstName: "", phone: "+000000000000000", domain });
    max = Math.max(max, analyseSmsText(sample).parts);
  }
  return max;
}

function toOutbound(m: QueuedMessage, ctx: LapContext): OutboundMessage {
  return {
    id: m.id,
    to: m.e164,
    senderId: m.senderId,
    text: m.text,
    encoding: m.encoding === "UCS2" ? "UCS2" : "GSM_7BIT",
    route: ctx.route.name,
    country: ctx.list.country,
  };
}

/**
 * The send loop (D2-04/D2-05): one `SendLapJob` sends one lap. Messages are created with
 * their debits in batches, submitted to the route's provider, and recorded with refunds for
 * failures; the campaign status and the emergency stop flag are checked between batches.
 * Idempotent: a retried or re-run job never creates a second message for a contact, and a
 * finished lap is a no-op. See docs/engineering/sending-engine.md.
 */
export async function sendLap(
  deps: SendLapDeps,
  job: SendLapJob,
  meta: JobMeta,
): Promise<SendLapResult> {
  const { store, log } = deps;
  const batchSize = deps.batchSize ?? DEFAULT_BATCH_SIZE;
  const pauseRetryMs = deps.pauseRetryMs ?? DEFAULT_PAUSE_RETRY_MS;
  const linksBaseUrl = deps.linksBaseUrl.replace(/\/+$/, "");
  const newShortCode = deps.shortCode ?? generateShortCode;
  const newDynamicId = deps.dynamicId ?? randomUUID;
  const fields = { jobId: meta.id, lapId: job.lapId, campaignId: job.campaignId };

  const loaded = await store.loadLapContext(job.lapId);
  if (!loaded) throw new UnrecoverableError(`lap ${job.lapId} not found`);
  const ctx: LapContext = loaded; // narrowed once, so the closures below see a non-null context
  if (ctx.lap.organisationId !== job.organisationId || ctx.lap.campaignId !== job.campaignId) {
    throw new UnrecoverableError(`lap ${job.lapId} does not belong to the job's campaign`);
  }
  if (ctx.lap.status === "done" || ctx.lap.status === "cancelled") {
    log("info", "lap already finished, nothing to do", { ...fields, status: ctx.lap.status });
    return { outcome: "skipped", sent: 0, failed: 0, reason: ctx.lap.status };
  }

  let runSent = 0;
  let runFailed = 0;

  async function cancel(reason: string, details?: Record<string, unknown>): Promise<SendLapResult> {
    await store.cancelLap({ lapId: ctx.lap.id, organisationId: ctx.lap.organisationId, reason });
    log("warn", "lap cancelled", { ...fields, reason, ...details });
    return { outcome: "cancelled", sent: runSent, failed: runFailed, reason };
  }

  async function guard(): Promise<Guard> {
    const status = await store.getCampaignStatus(ctx.lap.campaignId);
    if (status === "stopped") return { kind: "stop", reason: "campaign stopped" };
    if (status === "paused") return { kind: "pause" };
    if ((await deps.redis.get(progressKeys.stop(ctx.lap.organisationId))) !== null) {
      return { kind: "stop", reason: "emergency stop" };
    }
    return { kind: "go" };
  }

  async function pause(): Promise<SendLapResult> {
    log("info", "campaign paused, lap parked", { ...fields, retryInMs: pauseRetryMs });
    if (meta.delay) await meta.delay(pauseRetryMs);
    return { outcome: "paused", sent: runSent, failed: runFailed };
  }

  // Preconditions that cannot be fixed by retrying.
  const first = await guard();
  if (first.kind === "stop") return cancel(first.reason);
  if (first.kind === "pause") return pause();
  if (!ctx.route.active) return cancel("route inactive");
  if (!deps.providers.has(ctx.route.provider)) {
    return cancel(`unknown provider "${ctx.route.provider}"`);
  }
  const provider: Provider = resolveProviderForRoute(deps.providers, ctx.route);
  if (ctx.priceMicro === null) return cancel(`no price for route in ${ctx.list.country}`);
  if (ctx.texts.length === 0) return cancel("campaign has no active text");
  if (ctx.senderIds.length === 0) return cancel("campaign has no active sender id");
  const priceMicro = ctx.priceMicro;

  const existing = await store.countLapMessages(ctx.lap.id);
  let remaining = Math.max(0, ctx.lap.testSize - existing);

  if (existing === 0 && remaining > 0) {
    const estimate = BigInt(remaining) * BigInt(estimateMaxParts(ctx, linksBaseUrl)) * priceMicro;
    const balance = await store.getBalanceMicro(ctx.lap.organisationId);
    if (balance < estimate) {
      return cancel("insufficient balance", {
        balanceMicro: balance.toString(),
        estimateMicro: estimate.toString(),
      });
    }
  }

  const eligibility: EligibilityInput = {
    organisationId: ctx.lap.organisationId,
    listId: ctx.lap.listId,
    campaignId: ctx.lap.campaignId,
    contactReuse: ctx.campaign.contactReuse,
  };
  // Why members of the list are left out, counted before this run sends anything.
  const skipped = existing === 0 ? await store.countSkipReasons(eligibility) : null;

  await store.markLapStarted(ctx.lap.id);
  await deps.progress.setLapTotal(ctx.lap.campaignId, ctx.lap.id, ctx.lap.testSize);
  log("info", "lap started", {
    ...fields,
    testSize: ctx.lap.testSize,
    existing,
    remaining,
    skipped,
  });
  // Round-robin over sender ids and texts; a resumed lap continues where the count left off.
  let rotation = existing;

  function build(members: EligibleMember[]): NewMessageInput[] {
    return members.map((m) => {
      const senderId = ctx.senderIds[rotation % ctx.senderIds.length] ?? "";
      const adText = ctx.texts[rotation % ctx.texts.length];
      const template = adText?.text ?? "";
      rotation += 1;
      const shortCode = ctx.link ? newShortCode() : null;
      const text = renderMessageText(template, {
        firstName: m.firstName,
        phone: m.e164,
        domain: shortCode ? `${linksBaseUrl}/${shortCode}` : null,
      });
      const analysis = analyseSmsText(text);
      return {
        contactId: m.contactId,
        e164: m.e164,
        senderId,
        text,
        encoding: analysis.encoding,
        parts: analysis.parts,
        shortCode,
        dynamicId: newDynamicId(),
        adTextId: adText?.id ?? null,
        linkId: ctx.link?.id ?? null,
      };
    });
  }

  async function submit(batch: QueuedMessage[]): Promise<void> {
    const results = await provider.send(batch.map((m) => toOutbound(m, ctx)));
    const byId = new Map(results.map((r) => [r.id, r]));
    const outcomes: MessageOutcome[] = batch.map((m) => {
      const r = byId.get(m.id);
      const base = { messageId: m.id, contactId: m.contactId, parts: m.parts };
      if (r?.status === "accepted") {
        return { ...base, status: "sent", providerMessageId: r.providerMessageId };
      }
      return { ...base, status: "failed", errorCode: r ? r.reason : "NO_OUTCOME" };
    });
    await store.applyOutcomes({ lap: ctx.lap, priceMicro, outcomes });
    const sent = outcomes.filter((o) => o.status === "sent").length;
    const failed = outcomes.length - sent;
    runSent += sent;
    runFailed += failed;
    await deps.progress.recordBatch(ctx.lap.campaignId, ctx.lap.id, { sent, failed });
    log("info", "batch submitted", { ...fields, provider: provider.name, sent, failed });
  }

  // Messages left queued by an earlier attempt are submitted first.
  const pending = await store.listQueuedMessages(ctx.lap.id);
  for (let i = 0; i < pending.length; i += batchSize) {
    const g = await guard();
    if (g.kind === "stop") return cancel(g.reason);
    if (g.kind === "pause") return pause();
    await submit(pending.slice(i, i + batchSize));
  }

  while (remaining > 0) {
    const g = await guard();
    if (g.kind === "stop") return cancel(g.reason);
    if (g.kind === "pause") return pause();
    const created = await store.claimAndCreateMessages({
      lap: ctx.lap,
      eligibility,
      limit: Math.min(batchSize, remaining),
      priceMicro,
      build,
    });
    if (created.length === 0) break; // the list has no eligible member left
    remaining -= created.length;
    await submit(created);
  }

  const processed = existing + (ctx.lap.testSize - existing - remaining);
  if (processed !== ctx.lap.testSize) {
    await deps.progress.setLapTotal(ctx.lap.campaignId, ctx.lap.id, processed);
  }
  await store.finishLap({
    lapId: ctx.lap.id,
    organisationId: ctx.lap.organisationId,
    listId: ctx.lap.listId,
    details: {
      sent: ctx.lap.sent + runSent,
      failed: ctx.lap.failed + runFailed,
      planned: ctx.lap.testSize,
      skipped,
    },
  });
  await store.rankCampaignLaps(ctx.lap.campaignId);
  log("info", "lap done", { ...fields, sent: runSent, failed: runFailed, skipped });
  return { outcome: "done", sent: runSent, failed: runFailed };
}
