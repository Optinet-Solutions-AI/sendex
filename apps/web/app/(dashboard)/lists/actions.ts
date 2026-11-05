"use server";

import {
  cleanUploadRows,
  DUPLICATE_MODES,
  type ListCountry,
  ListCountrySchema,
  UPLOAD_CHUNK_SIZE,
  UploadRowSchema,
  type UploadSettingsInput,
  UploadSettingsSchema,
  type UploadSummary,
  UploadSummarySchema,
} from "@sendex/core";
import {
  createList,
  db,
  type FlushAllResult,
  flushAllLists,
  flushList,
  getList,
  importContacts,
  recordAudit,
} from "@sendex/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AuthError, requireAction } from "../../../lib/auth";

/**
 * Server actions for the lists screens. Every one resolves the tenant with `requireAction`,
 * validates its input with Zod and returns a result object rather than throwing, so the
 * client can show the message. Nothing here logs phone numbers.
 */
export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    if (error instanceof z.ZodError) {
      const first = error.issues[0];
      return {
        ok: false,
        error: `Invalid input: ${first?.path.join(".") ?? ""} ${first?.message ?? ""}`,
      };
    }
    if (error instanceof Error && error.message === "List not found") {
      return { ok: false, error: error.message };
    }
    console.error("lists action failed", error instanceof Error ? error.message : error);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

export async function flushListAction(listId: string): Promise<ActionResult<{ members: number }>> {
  return run(async () => {
    const ctx = await requireAction("list.flush");
    const id = z.uuid().parse(listId);
    const list = await getList(db(), ctx.organisationId, id);
    if (!list) throw new Error("List not found");
    const members = await flushList(db(), ctx.organisationId, id);
    await recordAudit(db(), ctx.organisationId, {
      actorUserId: ctx.userId,
      action: "list.flush",
      targetType: "list",
      targetId: id,
      details: { members, name: list.name },
    });
    revalidatePath("/lists");
    revalidatePath(`/lists/${id}`);
    return { members };
  });
}

export async function flushAllListsAction(): Promise<ActionResult<FlushAllResult>> {
  return run(async () => {
    const ctx = await requireAction("list.flush");
    const result = await flushAllLists(db(), ctx.organisationId);
    await recordAudit(db(), ctx.organisationId, {
      actorUserId: ctx.userId,
      action: "list.flush_all",
      targetType: "organisation",
      targetId: ctx.organisationId,
      details: { lists: result.lists, members: result.members },
    });
    revalidatePath("/lists");
    return result;
  });
}

export interface UploadTargetInfo {
  listId: string;
  name: string;
  country: ListCountry;
}

/** Step 1 of an upload: validate the settings and create or find the target list. */
export async function startUpload(
  input: UploadSettingsInput,
): Promise<ActionResult<UploadTargetInfo>> {
  return run(async () => {
    const ctx = await requireAction("list.upload");
    const settings = UploadSettingsSchema.parse(input);
    if (settings.target.kind === "new") {
      const list = await createList(db(), ctx.organisationId, settings.target);
      return { listId: list.id, name: list.name, country: settings.target.country };
    }
    const list = await getList(db(), ctx.organisationId, settings.target.listId);
    if (!list) throw new Error("List not found");
    return { listId: list.id, name: list.name, country: ListCountrySchema.parse(list.country) };
  });
}

const ImportChunkSchema = z.object({
  listId: z.uuid(),
  rows: z.array(UploadRowSchema).max(UPLOAD_CHUNK_SIZE),
  logicalCheck: z.boolean(),
  duplicates: z.enum(DUPLICATE_MODES),
});
export type ImportChunkInput = z.input<typeof ImportChunkSchema>;

/** Step 2, repeated: clean one chunk of rows with the list's country and import it. */
export async function importChunk(input: ImportChunkInput): Promise<ActionResult<UploadSummary>> {
  return run(async () => {
    const ctx = await requireAction("list.upload");
    const chunk = ImportChunkSchema.parse(input);
    const list = await getList(db(), ctx.organisationId, chunk.listId);
    if (!list) throw new Error("List not found");
    const cleaned = cleanUploadRows(chunk.rows, {
      defaultCountry: ListCountrySchema.parse(list.country),
      removeLandlines: chunk.logicalCheck,
    });
    const result = await importContacts(db(), ctx.organisationId, {
      listId: chunk.listId,
      rows: cleaned.kept,
      duplicates: chunk.duplicates,
      flushAfterImport: false,
    });
    return {
      ...cleaned.summary,
      imported: result.imported,
      skippedExisting: result.skippedExisting,
    };
  });
}

const FinishUploadSchema = z.object({
  listId: z.uuid(),
  logicalCheck: z.boolean(),
  duplicates: z.enum(DUPLICATE_MODES),
  flushAfterImport: z.boolean(),
  summary: UploadSummarySchema,
});
export type FinishUploadInput = z.input<typeof FinishUploadSchema>;

/** Step 3: optional flush, then the audit row with the totals. */
export async function finishUpload(
  input: FinishUploadInput,
): Promise<ActionResult<{ listId: string }>> {
  return run(async () => {
    const ctx = await requireAction("list.upload");
    const finish = FinishUploadSchema.parse(input);
    const list = await getList(db(), ctx.organisationId, finish.listId);
    if (!list) throw new Error("List not found");
    if (finish.flushAfterImport) await flushList(db(), ctx.organisationId, finish.listId);
    await recordAudit(db(), ctx.organisationId, {
      actorUserId: ctx.userId,
      action: "list.upload",
      targetType: "list",
      targetId: finish.listId,
      details: {
        name: list.name,
        country: list.country,
        logicalCheck: finish.logicalCheck,
        duplicatesMode: finish.duplicates,
        flushAfterImport: finish.flushAfterImport,
        ...finish.summary,
      },
    });
    revalidatePath("/lists");
    revalidatePath(`/lists/${finish.listId}`);
    return { listId: finish.listId };
  });
}
