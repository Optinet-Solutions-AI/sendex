"use server";

import { enrichmentRuleSchema, hlrVerifySchema } from "@sendex/core";
import {
  countUnverified,
  createVerificationRequest,
  db,
  deleteEnrichmentRule,
  getList,
  lookupPriceFor,
  recordAudit,
  upsertEnrichmentRule,
} from "@sendex/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AuthError, requireAction } from "../../../lib/auth";

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    if (error instanceof z.ZodError) {
      return { ok: false, error: error.issues.map((i) => i.message).join("; ") };
    }
    if (error instanceof Error) return { ok: false, error: error.message };
    return { ok: false, error: "Something went wrong" };
  }
}

export async function upsertEnrichmentRuleAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  return run(async () => {
    const ctx = await requireAction("list.upload");
    const data = enrichmentRuleSchema.parse(input);
    const row = await upsertEnrichmentRule(db(), ctx.organisationId, data);
    await recordAudit(db(), ctx.organisationId, {
      actorUserId: ctx.userId,
      action: "enrichment.rule",
      targetType: "enrichment_rule",
      targetId: row.id,
      details: {
        country: data.country,
        dailyLimit: data.dailyLimit,
        monthlyBudgetEur: data.monthlyBudgetEur,
      },
    });
    revalidatePath("/enrichment");
    return { id: row.id };
  });
}

export async function deleteEnrichmentRuleAction(input: unknown): Promise<ActionResult<null>> {
  return run(async () => {
    const ctx = await requireAction("list.upload");
    const { id } = z.object({ id: z.string().uuid() }).parse(input);
    if (!(await deleteEnrichmentRule(db(), ctx.organisationId, id)))
      throw new Error("Rule not found");
    revalidatePath("/enrichment");
    return null;
  });
}

export interface HlrVerifyEstimate {
  count: number;
  priceMicro: string | null;
  costMicro: string | null;
}

/** How many numbers of the list are unverified and what the lookup would cost. */
export async function hlrVerifyEstimateAction(
  input: unknown,
): Promise<ActionResult<HlrVerifyEstimate>> {
  return run(async () => {
    const ctx = await requireAction("list.view");
    const { listId } = hlrVerifySchema.parse(input);
    const list = await getList(db(), ctx.organisationId, listId);
    if (!list) throw new Error("List not found");
    const [count, price] = await Promise.all([
      countUnverified(db(), ctx.organisationId, { listId, includeArchived: true }),
      lookupPriceFor(db(), list.country),
    ]);
    return {
      count,
      priceMicro: price ? price.priceMicro.toString() : null,
      costMicro: price ? (price.priceMicro * BigInt(count)).toString() : null,
    };
  });
}

/** HLR Verify: queue a verification request for the list's unverified numbers. */
export async function hlrVerifyAction(
  input: unknown,
): Promise<ActionResult<{ requestId: string; count: number }>> {
  return run(async () => {
    const ctx = await requireAction("list.upload");
    const { listId } = hlrVerifySchema.parse(input);
    const list = await getList(db(), ctx.organisationId, listId);
    if (!list) throw new Error("List not found");
    if (!(await lookupPriceFor(db(), list.country))) {
      throw new Error(`No lookup route covers ${list.country} yet`);
    }
    const count = await countUnverified(db(), ctx.organisationId, {
      listId,
      includeArchived: true,
    });
    if (count === 0) throw new Error("Every number of this list is verified already");
    const request = await createVerificationRequest(db(), ctx.organisationId, {
      country: list.country,
      source: "hlr_verify",
      listId,
      limit: count,
      requestedBy: ctx.userId,
    });
    await recordAudit(db(), ctx.organisationId, {
      actorUserId: ctx.userId,
      action: "list.hlr_verify",
      targetType: "list",
      targetId: listId,
      details: { requestId: request.id, count },
    });
    revalidatePath(`/lists/${listId}`);
    revalidatePath("/enrichment");
    return { requestId: request.id, count };
  });
}
