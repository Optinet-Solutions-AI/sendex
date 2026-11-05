import { randomUUID } from "node:crypto";
import {
  analyseSmsText,
  type CapReason,
  capDecision,
  capReasonLabel,
  formatEur,
  renderMessageText,
  startOfUtcDay,
  utcDayKey,
} from "@sendex/core";
import type {
  CapsStore,
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
  /** Daily caps (D3-11). Absent means no cap is enforced (unit tests of the loop itself). */
  caps?: CapsStore;
  /** The clock, for the UTC day the caps apply to. Default `new Date()`. */
  now?: () => Date;
}

export type SendLapOutcome = "done" | "cancelled" | "paused" | "skipped";

export interface SendLapResult {
  outcome: SendLapOutcome;
  /** Messages accepted and failed by this run (not the lap totals). */
  sent: number;
  failed: number;
  reason?: string;
  /** Messages the lap wanted to send but a daily cap refused (D3-11). */
  refused?: number;
}

type Guard =
  | { kind: "go"; limit?: number }
  | { kind: "stop"; reason: string }
  | { kind: "pause" }
  /** A daily cap leaves no room today; `cap` is the value that binds. */
  | { kind: "refuse"; reason: CapReason; cap: number | bigint };

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
  const now = deps.now ?? (() => new Date());
  const fields = { jobId: meta.id, lapId: job.lapId, campaignId: job.campaignId };

  const loaded = await store.loadLapContext(job.lapId);
  if (!loaded) throw new UnrecoverableError(`lap ${job.lapId} not found`);
  const ctx: LapContext = loaded; // narrowed once, so the closures below see a non-null context
  if (ctx.lap.organisationId !== job.organisationId || ctx.lap.campaignId !== job.campaignId) {
    throw new UnrecoverableError(`lap ${job.lapId} does not belong to the job's campaign`);
  }
  if (ctx.lap.status === "cancelled") {
    // Stopped from the campaign page while this job was parked or between attempts: the lap
    // row is already cancelled; sweep any message an earlier attempt left queued (refunded).
    await store.cancelLap({
      lapId: ctx.lap.id,
      organisationId: ctx.lap.organisationId,
      reason: "campaign stopped",
    });
  }
  if (ctx.lap.status === "done" || ctx.lap.status === "cancelled") {
    log("info", "lap already finished, nothing to do", { ...fields, status: ctx.lap.status });
    return { outcome: "skipped", sent: 0, failed: 0, reason: ctx.lap.status };
  }

  let runSent = 0;
  let runFailed = 0;
  /** Set once the route price is known; until then the guard skips the caps. */
  let pricing: { priceMicro: bigint; maxParts: number } | null = null;

  async function cancel(reason: string, details?: Record<string, unknown>): Promise<SendLapResult> {
    await store.cancelLap({ lapId: ctx.lap.id, organisationId: ctx.lap.organisationId, reason });
    log("warn", "lap cancelled", { ...fields, reason, ...details });
    return { outcome: "cancelled", sent: runSent, failed: runFailed, reason };
  }

  /**
   * Re-read the campaign status and the emergency stop flag; with `wanted > 0` also ask the
   * daily caps (D3-11) how many of the next `wanted` messages may still go today.
   */
  async function guard(wanted = 0): Promise<Guard> {
    const status = await store.getCampaignStatus(ctx.lap.campaignId);
    if (status === "stopped") return { kind: "stop", reason: "campaign stopped" };
    if (status === "paused") return { kind: "pause" };
    if ((await deps.redis.get(progressKeys.stop(ctx.lap.organisationId))) !== null) {
      return { kind: "stop", reason: "emergency stop" };
    }
    if (wanted > 0 && deps.caps && pricing) {
      const caps = await deps.caps.getDailyCaps(ctx.lap.organisationId);
      if (caps.dailyMessageCap === null && caps.dailySpendCapMicro === null) {
        return { kind: "go" };
      }
      const usage = await deps.caps.getDailyUsage(ctx.lap.organisationId, startOfUtcDay(now()));
      const decision = capDecision({
        sentToday: usage.messages,
        spentTodayMicro: usage.spentMicro,
        batchSize: wanted,
        batchCostMicro: BigInt(wanted) * BigInt(pricing.maxParts) * pricing.priceMicro,
        caps,
      });
      if (decision.action === "refuse") {
        const cap =
          decision.reason === "daily_message_cap"
            ? (caps.dailyMessageCap ?? 0)
            : (caps.dailySpendCapMicro ?? 0n);
        return { kind: "refuse", reason: decision.reason, cap };
      }
      if (decision.action === "trim") return { kind: "go", limit: decision.allowed };
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
  pricing = { priceMicro, maxParts: estimateMaxParts(ctx, linksBaseUrl) };

  const existing = await store.countLapMessages(ctx.lap.id);
  let remaining = Math.max(0, ctx.lap.testSize - existing);
  let refused = 0;
  let refusalReason: CapReason | null = null;

  /**
   * A daily cap leaves no room: the rest of the lap is refused (recorded on the lap row), an
   * alert is raised once per day, and the campaign is paused, not stopped, so the owner can
   * raise the cap and resume. The lap then finishes with what it sent.
   */
  async function refuse(caps: CapsStore, g: Extract<Guard, { kind: "refuse" }>): Promise<void> {
    refused = remaining;
    refusalReason = g.reason;
    const capValue = typeof g.cap === "bigint" ? g.cap.toString() : g.cap;
    const capText = typeof g.cap === "bigint" ? formatEur(g.cap) : String(g.cap);
    const label = capReasonLabel(g.reason);
    const message = `${label.charAt(0).toUpperCase()}${label.slice(1)} of ${capText} reached: ${refused} messages refused.`;
    await caps.recordLapRefusal({
      lapId: ctx.lap.id,
      organisationId: ctx.lap.organisationId,
      refused,
      reason: g.reason,
    });
    await caps.raiseAlert(ctx.lap.organisationId, {
      kind: g.reason,
      periodKey: utcDayKey(now()),
      message,
      details: { cap: capValue, refused, lapId: ctx.lap.id, campaignId: ctx.lap.campaignId },
    });
    await caps.pauseCampaign({
      campaignId: ctx.lap.campaignId,
      organisationId: ctx.lap.organisationId,
      reason: g.reason,
      details: { lapId: ctx.lap.id, refused, cap: capValue },
    });
    log("warn", "daily cap reached, rest of the lap refused and campaign paused", {
      ...fields,
      reason: g.reason,
      cap: capValue,
      refused,
    });
  }

  if (existing === 0 && remaining > 0) {
    const estimate = BigInt(remaining) * BigInt(pricing.maxParts) * priceMicro;
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
      const template = ctx.texts[rotation % ctx.texts.length]?.text ?? "";
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
    const wanted = Math.min(batchSize, remaining);
    const g = await guard(wanted);
    if (g.kind === "stop") return cancel(g.reason);
    if (g.kind === "pause") return pause();
    if (g.kind === "refuse") {
      if (deps.caps) await refuse(deps.caps, g);
      break;
    }
    const created = await store.claimAndCreateMessages({
      lap: ctx.lap,
      eligibility,
      limit: Math.min(wanted, g.limit ?? wanted),
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
      ...(refusalReason ? { refused, refusalReason } : {}),
    },
  });
  await store.rankCampaignLaps(ctx.lap.campaignId);
  log("info", "lap done", { ...fields, sent: runSent, failed: runFailed, skipped, refused });
  if (refusalReason) {
    return {
      outcome: "done",
      sent: runSent,
      failed: runFailed,
      refused,
      reason: capReasonLabel(refusalReason),
    };
  }
  return { outcome: "done", sent: runSent, failed: runFailed };
}
