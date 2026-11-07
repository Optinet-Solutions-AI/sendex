import { ruleAllowance } from "@sendex/core";
import type {
  EnrichmentRuleRow,
  LookupOutcome,
  RuleUsage,
  VerificationRequestRow,
  VerificationTarget,
} from "@sendex/db";
import type { LookupProvider } from "@sendex/providers";
import { UnrecoverableError } from "bullmq";
import type { VerifyJob } from "../jobs.js";
import type { Logger } from "../log.js";

/**
 * Numbers Verification (D4-07): the worker side. `runVerification` looks a request's numbers
 * up in batches, records every answer with its debit and finishes the request;
 * `dispatchVerification` enqueues queued requests (HLR Verify) and creates one per
 * scheduled enrichment rule that still has allowance today.
 */

export interface VerificationStore {
  claimVerificationRequest(id: string): Promise<VerificationRequestRow | null>;
  verificationTargets(
    request: Pick<
      VerificationRequestRow,
      "organisationId" | "country" | "listId" | "limit" | "ruleId"
    >,
    includeArchived: boolean,
  ): Promise<VerificationTarget[]>;
  recordLookupResults(input: {
    request: Pick<VerificationRequestRow, "id" | "organisationId" | "country">;
    results: readonly LookupOutcome[];
    priceMicro: bigint;
    provider: string;
  }): Promise<void>;
  finishVerificationRequest(id: string, status: "done" | "failed"): Promise<void>;
  lookupPriceFor(country: string): Promise<{ priceMicro: bigint } | null>;
  getBalanceMicro(organisationId: string): Promise<bigint>;
  ruleIncludesArchived(ruleId: string | null): Promise<boolean>;
}

export interface VerificationDispatchStore {
  listQueuedVerificationRequests(): Promise<VerificationRequestRow[]>;
  scheduledEnrichmentRules(): Promise<EnrichmentRuleRow[]>;
  ruleUsage(ruleId: string, now: Date): Promise<RuleUsage>;
  lookupPriceFor(country: string): Promise<{ priceMicro: bigint } | null>;
  countUnverified(
    organisationId: string,
    scope: { country: string; includeArchived: boolean },
  ): Promise<number>;
  createVerificationRequest(
    organisationId: string,
    input: { country: string; source: "rule"; ruleId: string; limit: number },
  ): Promise<VerificationRequestRow>;
}

export interface VerifyQueueLike {
  add(name: string, data: VerifyJob, opts?: { jobId: string }): Promise<unknown>;
}

export const LOOKUP_BATCH = 100;

export async function runVerification(
  deps: { store: VerificationStore; lookup: LookupProvider | null; log: Logger; batch?: number },
  job: VerifyJob,
): Promise<{ outcome: "done" | "failed" | "skipped"; verified: number }> {
  const { store, log } = deps;
  const request = await store.claimVerificationRequest(job.requestId);
  if (!request) {
    log("info", "verification request already taken or gone", { requestId: job.requestId });
    return { outcome: "skipped", verified: 0 };
  }
  if (request.organisationId !== job.organisationId) {
    throw new UnrecoverableError(
      `request ${job.requestId} does not belong to the job's organisation`,
    );
  }
  if (!deps.lookup) {
    await store.finishVerificationRequest(request.id, "failed");
    log("warn", "verification skipped: no lookup provider", { requestId: request.id });
    return { outcome: "failed", verified: 0 };
  }
  const price = await store.lookupPriceFor(request.country);
  if (!price) {
    await store.finishVerificationRequest(request.id, "failed");
    log("warn", "verification skipped: no lookup price for country", {
      requestId: request.id,
      country: request.country,
    });
    return { outcome: "failed", verified: 0 };
  }
  const includeArchived = await store.ruleIncludesArchived(request.ruleId);
  const targets = await store.verificationTargets(request, includeArchived);
  let verified = 0;
  const batch = deps.batch ?? LOOKUP_BATCH;
  for (let i = 0; i < targets.length; i += batch) {
    const chunk = targets.slice(i, i + batch);
    const cost = price.priceMicro * BigInt(chunk.length);
    if ((await store.getBalanceMicro(request.organisationId)) < cost) {
      log("warn", "verification stopped: insufficient balance", {
        requestId: request.id,
        verified,
      });
      break;
    }
    const results = await deps.lookup.lookup(
      chunk.map((t) => ({ e164: t.e164, country: t.country })),
    );
    await store.recordLookupResults({
      request,
      results,
      priceMicro: price.priceMicro,
      provider: deps.lookup.name,
    });
    verified += results.length;
  }
  await store.finishVerificationRequest(request.id, "done");
  log("info", "verification finished", {
    requestId: request.id,
    verified,
    targets: targets.length,
  });
  return { outcome: "done", verified };
}

export function verifyJobId(requestId: string): string {
  return `verify:${requestId}`;
}

export async function dispatchVerification(deps: {
  store: VerificationDispatchStore;
  queue: VerifyQueueLike;
  log: Logger;
  now?: () => Date;
}): Promise<{ enqueued: number; created: number }> {
  const now = deps.now?.() ?? new Date();
  let created = 0;
  for (const rule of await deps.store.scheduledEnrichmentRules()) {
    const [usage, price] = await Promise.all([
      deps.store.ruleUsage(rule.id, now),
      deps.store.lookupPriceFor(rule.country),
    ]);
    const allowance = ruleAllowance({
      dailyLimit: rule.dailyLimit,
      monthlyBudgetMicro: rule.monthlyBudgetMicro,
      verifiedToday: usage.verifiedToday,
      spentThisMonthMicro: usage.spentThisMonthMicro,
      priceMicro: price?.priceMicro ?? null,
    });
    if (allowance <= 0) continue;
    const pending = await deps.store.countUnverified(rule.organisationId, {
      country: rule.country,
      includeArchived: rule.includeArchived,
    });
    if (pending <= 0) continue;
    await deps.store.createVerificationRequest(rule.organisationId, {
      country: rule.country,
      source: "rule",
      ruleId: rule.id,
      limit: Math.min(allowance, pending),
    });
    created += 1;
  }
  let enqueued = 0;
  for (const request of await deps.store.listQueuedVerificationRequests()) {
    await deps.queue.add(
      "verify",
      { organisationId: request.organisationId, requestId: request.id },
      { jobId: verifyJobId(request.id) },
    );
    enqueued += 1;
  }
  if (created + enqueued > 0) deps.log("info", "verification dispatched", { created, enqueued });
  return { enqueued, created };
}
