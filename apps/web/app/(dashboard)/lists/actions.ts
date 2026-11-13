"use server";

import {
  cleanUploadRows,
  DUPLICATE_MODES,
  importedGood,
  type ListCountry,
  ListCountrySchema,
  timezoneForCountry,
  totalDropped,
  UPLOAD_CHUNK_SIZE,
  UploadRowSchema,
  type UploadSettingsInput,
  UploadSettingsSchema,
  type UploadSummary,
  UploadSummarySchema,
} from "@sendex/core";
import {
  createCampaign,
  createList,
  createListImport,
  db,
  deleteListImport,
  deleteLists,
  type FlushAllResult,
  flushAllLists,
  flushList,
  getList,
  importContacts,
  recordAudit,
  setCampaignLists,
  setListArchived,
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
    // SMS Edge semantics: with the logical check on, landlines and suspicious patterns are
    // kept as Bad members rather than dropped; premium and toll-free numbers are rejected.
    const cleaned = cleanUploadRows(chunk.rows, {
      defaultCountry: ListCountrySchema.parse(list.country),
      removeLandlines: chunk.logicalCheck,
      keepBad: chunk.logicalCheck,
    });
    const result = await importContacts(db(), ctx.organisationId, {
      listId: chunk.listId,
      rows: cleaned.kept.map(({ bad, ...row }) => ({
        ...row,
        ...(bad ? { bad: true, badReason: bad } : {}),
      })),
      duplicates: chunk.duplicates,
      flushAfterImport: false,
    });
    // Bad rows that were skipped as already known do not count as added bad.
    const summary: UploadSummary = {
      ...cleaned.summary,
      addedBad: result.importedBad,
      imported: result.imported,
      skippedExisting: result.skippedExisting,
      samples: { ...cleaned.summary.samples, skipped: result.skippedSamples },
    };
    return summary;
  });
}

const FinishUploadSchema = z.object({
  listId: z.uuid(),
  fileName: z.string().trim().min(1).max(300).default("pasted text"),
  source: z.enum(["file", "paste"]).default("file"),
  logicalCheck: z.boolean(),
  duplicates: z.enum(DUPLICATE_MODES),
  flushAfterImport: z.boolean(),
  summary: UploadSummarySchema,
});
export type FinishUploadInput = z.input<typeof FinishUploadSchema>;

/** Step 3, once per file: the import record for the Files page, an optional flush, the audit row. */
export async function finishUpload(
  input: FinishUploadInput,
): Promise<ActionResult<{ listId: string; importId: string }>> {
  return run(async () => {
    const ctx = await requireAction("list.upload");
    const finish = FinishUploadSchema.parse(input);
    const list = await getList(db(), ctx.organisationId, finish.listId);
    if (!list) throw new Error("List not found");
    const s = finish.summary;
    const bad = s.addedBad.landline + s.addedBad.suspicious;
    const job = await createListImport(db(), ctx.organisationId, {
      listId: finish.listId,
      fileName: finish.fileName,
      source: finish.source,
      rowsInFile: s.rows,
      valid: s.rows - totalDropped(s),
      added: s.imported,
      addedGood: importedGood(s),
      addedBad: bad,
      rejected: totalDropped(s),
      skipped: s.skippedExisting,
      duplicates: s.duplicates,
      dedup: finish.duplicates === "skip_existing",
      summary: s,
    });
    if (finish.flushAfterImport) await flushList(db(), ctx.organisationId, finish.listId);
    await recordAudit(db(), ctx.organisationId, {
      actorUserId: ctx.userId,
      action: "list.upload",
      targetType: "list",
      targetId: finish.listId,
      details: {
        name: list.name,
        country: list.country,
        fileName: finish.fileName,
        importId: job.id,
        logicalCheck: finish.logicalCheck,
        duplicatesMode: finish.duplicates,
        flushAfterImport: finish.flushAfterImport,
        rows: s.rows,
        imported: s.imported,
        addedBad: bad,
        rejected: totalDropped(s),
        skippedExisting: s.skippedExisting,
        duplicates: s.duplicates,
      },
    });
    revalidatePath("/lists");
    revalidatePath("/lists/files");
    revalidatePath(`/lists/${finish.listId}`);
    return { listId: finish.listId, importId: job.id };
  });
}

/** Remove an import record from the Files page (its numbers stay in the list). */
export async function deleteListImportAction(
  importId: string,
): Promise<ActionResult<{ deleted: boolean }>> {
  return run(async () => {
    const ctx = await requireAction("list.upload");
    const id = z.uuid().parse(importId);
    const deleted = await deleteListImport(db(), ctx.organisationId, id);
    revalidatePath("/lists/files");
    return { deleted };
  });
}

/** "+ New Campaign" on a list: a draft named after the list, in its country, with it attached. */
export async function createCampaignFromListAction(
  listId: string,
): Promise<ActionResult<{ campaignId: string }>> {
  return run(async () => {
    const ctx = await requireAction("campaign.create");
    const id = z.uuid().parse(listId);
    const list = await getList(db(), ctx.organisationId, id);
    if (!list) throw new Error("List not found");
    const campaign = await createCampaign(db(), ctx.organisationId, {
      name: list.name,
      country: list.country,
      timezone: timezoneForCountry(list.country),
      createdBy: ctx.userId,
    });
    await setCampaignLists(db(), ctx.organisationId, campaign.id, [id]);
    await recordAudit(db(), ctx.organisationId, {
      actorUserId: ctx.userId,
      action: "campaign.create",
      targetType: "campaign",
      targetId: campaign.id,
      details: { name: campaign.name, country: campaign.country, fromListId: id },
    });
    revalidatePath("/campaigns");
    return { campaignId: campaign.id };
  });
}

/** Archive hides a list from the table and the campaign pickers; unarchive brings it back. */
export async function archiveListAction(
  listId: string,
  archived: boolean,
): Promise<ActionResult<{ archived: boolean }>> {
  return run(async () => {
    const ctx = await requireAction("list.upload");
    const id = z.uuid().parse(listId);
    const list = await getList(db(), ctx.organisationId, id);
    if (!list) throw new Error("List not found");
    await setListArchived(db(), ctx.organisationId, id, archived);
    await recordAudit(db(), ctx.organisationId, {
      actorUserId: ctx.userId,
      action: archived ? "list.archive" : "list.unarchive",
      targetType: "list",
      targetId: id,
      details: { name: list.name },
    });
    revalidatePath("/lists");
    revalidatePath(`/lists/${id}`);
    return { archived };
  });
}

/** Delete one or more lists for good (owner only); contacts stay in the organisation. */
export async function deleteListsAction(
  listIds: readonly string[],
): Promise<ActionResult<{ deleted: number }>> {
  return run(async () => {
    const ctx = await requireAction("list.delete");
    const ids = z.array(z.uuid()).min(1).max(500).parse(listIds);
    const deleted = await deleteLists(db(), ctx.organisationId, ids);
    await recordAudit(db(), ctx.organisationId, {
      actorUserId: ctx.userId,
      action: "list.delete",
      targetType: "list",
      targetId: ids[0] ?? "",
      details: { listIds: ids, deleted },
    });
    revalidatePath("/lists");
    return { deleted };
  });
}
