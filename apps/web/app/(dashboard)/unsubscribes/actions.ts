"use server";

import { normaliseSuppressionBatch } from "@sendex/core";
import {
  addSuppressions,
  createSuppressionImport,
  db,
  recordAudit,
  removeSuppressions,
  updateSuppressionImportCount,
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

const numbersInput = z.array(z.string().trim().min(1).max(40)).min(1).max(20_000);

export interface SuppressResult {
  added: number;
  rejected: string[];
}

/** "+ Add number": one or more numbers in international format, suppressed account-wide. */
export async function addSuppressionNumbersAction(
  input: unknown,
): Promise<ActionResult<SuppressResult>> {
  return run(async () => {
    const ctx = await requireAction("list.upload");
    const raws = numbersInput.parse(input);
    const { numbers, rejected } = normaliseSuppressionBatch(raws);
    if (numbers.length === 0) throw new Error("No number in international format found");
    const added = await addSuppressions(db(), ctx.organisationId, { numbers, source: "manual" });
    await recordAudit(db(), ctx.organisationId, {
      actorUserId: ctx.userId,
      action: "unsubscribe.add",
      targetType: "organisation",
      targetId: ctx.organisationId,
      details: { numbers: numbers.length, added, rejected: rejected.length },
    });
    revalidatePath("/unsubscribes");
    return { added, rejected };
  });
}

/** "Resubscribe": the numbers leave the suppression list and can be sent to again. */
export async function resubscribeAction(
  input: unknown,
): Promise<ActionResult<{ removed: number }>> {
  return run(async () => {
    const ctx = await requireAction("list.upload");
    const raws = numbersInput.parse(input);
    const { numbers } = normaliseSuppressionBatch(raws);
    if (numbers.length === 0) throw new Error("No number in international format found");
    const removed = await removeSuppressions(
      db(),
      ctx.organisationId,
      numbers.map((n) => n.e164),
    );
    await recordAudit(db(), ctx.organisationId, {
      actorUserId: ctx.userId,
      action: "unsubscribe.remove",
      targetType: "organisation",
      targetId: ctx.organisationId,
      details: { numbers: numbers.length, removed },
    });
    revalidatePath("/unsubscribes");
    return { removed };
  });
}

const importInput = z.object({
  fileName: z.string().trim().min(1).max(300),
  numbers: z.array(z.string().trim().max(40)).max(200_000),
});

/** "Upload unsubscribes": the chosen column of a CSV, XLS or XLSX as a suppression file. */
export async function importSuppressionsAction(
  input: unknown,
): Promise<ActionResult<{ importId: string; added: number; rejected: number }>> {
  return run(async () => {
    const ctx = await requireAction("list.upload");
    const data = importInput.parse(input);
    const { numbers, rejected } = normaliseSuppressionBatch(data.numbers);
    if (numbers.length === 0)
      throw new Error("No number in international format found in that column");
    const job = await createSuppressionImport(db(), ctx.organisationId, {
      fileName: data.fileName,
      count: 0,
      rejected: rejected.length,
    });
    const added = await addSuppressions(db(), ctx.organisationId, {
      numbers,
      source: "upload",
      importId: job.id,
    });
    await updateSuppressionImportCount(db(), ctx.organisationId, job.id, added);
    await recordAudit(db(), ctx.organisationId, {
      actorUserId: ctx.userId,
      action: "unsubscribe.import",
      targetType: "organisation",
      targetId: ctx.organisationId,
      details: { fileName: data.fileName, importId: job.id, added, rejected: rejected.length },
    });
    revalidatePath("/unsubscribes");
    return { importId: job.id, added, rejected: rejected.length };
  });
}
