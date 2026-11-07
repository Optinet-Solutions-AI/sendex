"use server";

import { type SegmentGroup, segmentGroupSchema, segmentSchema } from "@sendex/core";
import {
  createSegment,
  db,
  deleteSegment,
  duplicateSegment,
  getSegment,
  listCampaignNames,
  listListNames,
  previewSegment,
  recordAudit,
  refreshSegmentStats,
  type SegmentPreview,
  updateSegment,
} from "@sendex/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { aiRulesEnabled, generateRules } from "../../../lib/ai-rules";
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

const uuid = z.uuid();

/** The live Preview card: counts, a sample and the breakdowns for the rules as they are. */
export async function previewSegmentAction(input: unknown): Promise<ActionResult<SegmentPreview>> {
  return run(async () => {
    const ctx = await requireAction("list.view");
    const definition = segmentGroupSchema.parse(input);
    return previewSegment(db(), ctx.organisationId, definition);
  });
}

export async function createSegmentAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return run(async () => {
    const ctx = await requireAction("list.upload");
    const data = segmentSchema.parse(input);
    const row = await createSegment(db(), ctx.organisationId, data);
    await recordAudit(db(), ctx.organisationId, {
      actorUserId: ctx.userId,
      action: "segment.create",
      targetType: "segment",
      targetId: row.id,
      details: { name: row.name, summary: row.summary, globalExclude: row.globalExclude },
    });
    revalidatePath("/segments");
    return { id: row.id };
  });
}

const updateInput = segmentSchema.extend({ segmentId: uuid });

export async function updateSegmentAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return run(async () => {
    const ctx = await requireAction("list.upload");
    const { segmentId, ...data } = updateInput.parse(input);
    const row = await updateSegment(db(), ctx.organisationId, segmentId, data);
    await recordAudit(db(), ctx.organisationId, {
      actorUserId: ctx.userId,
      action: "segment.update",
      targetType: "segment",
      targetId: row.id,
      details: { name: row.name, summary: row.summary, globalExclude: row.globalExclude },
    });
    revalidatePath("/segments");
    revalidatePath(`/segments/${segmentId}`);
    return { id: row.id };
  });
}

export async function duplicateSegmentAction(
  segmentId: string,
): Promise<ActionResult<{ id: string }>> {
  return run(async () => {
    const ctx = await requireAction("list.upload");
    const id = uuid.parse(segmentId);
    const copy = await duplicateSegment(db(), ctx.organisationId, id);
    await recordAudit(db(), ctx.organisationId, {
      actorUserId: ctx.userId,
      action: "segment.duplicate",
      targetType: "segment",
      targetId: copy.id,
      details: { sourceSegmentId: id, name: copy.name },
    });
    revalidatePath("/segments");
    return { id: copy.id };
  });
}

export async function deleteSegmentAction(
  segmentId: string,
): Promise<ActionResult<{ deleted: boolean }>> {
  return run(async () => {
    const ctx = await requireAction("list.delete");
    const id = uuid.parse(segmentId);
    const existing = await getSegment(db(), ctx.organisationId, id);
    const deleted = await deleteSegment(db(), ctx.organisationId, id);
    if (deleted) {
      await recordAudit(db(), ctx.organisationId, {
        actorUserId: ctx.userId,
        action: "segment.delete",
        targetType: "segment",
        targetId: id,
        details: { name: existing?.name ?? null },
      });
    }
    revalidatePath("/segments");
    return { deleted };
  });
}

/** Refresh Stats: recount size and good for every segment (or the given ones). */
export async function refreshSegmentStatsAction(
  segmentIds?: readonly string[],
): Promise<ActionResult<{ refreshed: number }>> {
  return run(async () => {
    const ctx = await requireAction("list.view");
    const ids = segmentIds ? z.array(uuid).max(500).parse(segmentIds) : undefined;
    const refreshed = await refreshSegmentStats(db(), ctx.organisationId, ids);
    revalidatePath("/segments");
    return { refreshed };
  });
}

const generateInput = z.object({
  prompt: z.string().trim().min(1).max(2_000),
  current: segmentGroupSchema,
});

/** The AI Rule Generator: plain English to rules, adding to or amending the current ones. */
export async function generateRulesAction(
  input: unknown,
): Promise<ActionResult<{ definition: SegmentGroup; note: string }>> {
  return run(async () => {
    const ctx = await requireAction("list.upload");
    if (!aiRulesEnabled()) throw new Error("The AI rule generator is turned off.");
    const data = generateInput.parse(input);
    const [lists, campaigns] = await Promise.all([
      listListNames(db(), ctx.organisationId),
      listCampaignNames(db(), ctx.organisationId),
    ]);
    const result = await generateRules({ ...data, lists, campaigns });
    if (!result.ok) throw new Error(result.error);
    return { definition: result.definition, note: result.note };
  });
}
