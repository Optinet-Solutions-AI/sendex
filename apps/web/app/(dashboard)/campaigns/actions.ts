"use server";

import {
  type Action,
  adTextSchema,
  hasDomainPlaceholder,
  lapCommentSchema,
  lapScheduleSchema,
  linkSchema,
  newCampaignSchema,
  senderIdsInputSchema,
  sendSettingsSchema,
  sidGroupSchema,
  splitAdTexts,
  topUpSchema,
} from "@sendex/core";
import {
  addAdTexts,
  addSenderIds,
  attachLink,
  createCampaign,
  createLaps,
  createLink,
  createSidGroup,
  db,
  deleteCampaign,
  detachLink,
  duplicateCampaign,
  estimateSend,
  flushLap,
  listSidGroups,
  recordAudit,
  rescheduleLap,
  setAllLapsOn,
  setCampaignLists,
  setCampaignSidGroup,
  setLapComment,
  setLapOn,
  toggleAdText,
  toggleCampaignLink,
  toggleSenderId,
  topUpLaps,
  updateAdText,
  updateSendSettings,
} from "@sendex/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type {
  ActionResult,
  AdTextView,
  EstimateView,
  LapView,
  SidGroupView,
} from "../../../components/campaigns/types";
import { AuthError, type OrgContext, requireAction } from "../../../lib/auth";
import { toEstimateView, toLapView, toSidGroupView } from "../../../lib/campaign-views";

/**
 * Every mutation of the campaign screens: validated with the Zod schemas from `@sendex/core`,
 * guarded by `requireAction`, scoped to the caller's organisation and returned as an
 * `ActionResult` so the client can show the message instead of crashing the route.
 */

async function run<T>(
  action: Action,
  fn: (ctx: OrgContext) => Promise<T>,
): Promise<ActionResult<T>> {
  try {
    const ctx = await requireAction(action);
    return { ok: true, data: await fn(ctx) };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    if (error instanceof z.ZodError) {
      return { ok: false, error: error.issues.map((i) => i.message).join("; ") };
    }
    if (error instanceof Error) return { ok: false, error: error.message };
    return { ok: false, error: "Something went wrong" };
  }
}

const uuid = z.string().uuid();
const campaignRef = z.object({ campaignId: uuid });

function revalidateCampaign(campaignId: string): void {
  revalidatePath("/campaigns");
  revalidatePath(`/campaigns/${campaignId}`);
}

// ---------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------

export async function createCampaignAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return run("campaign.create", async (ctx) => {
    const data = newCampaignSchema.parse(input);
    const database = db();
    const campaign = await createCampaign(database, ctx.organisationId, {
      ...data,
      createdBy: ctx.userId,
    });
    await recordAudit(database, ctx.organisationId, {
      actorUserId: ctx.userId,
      action: "campaign.create",
      targetType: "campaign",
      targetId: campaign.id,
      details: { name: campaign.name, country: campaign.country, timezone: campaign.timezone },
    });
    revalidatePath("/campaigns");
    return { id: campaign.id };
  });
}

export async function duplicateCampaignAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  return run("campaign.create", async (ctx) => {
    const { campaignId } = campaignRef.parse(input);
    const database = db();
    const copy = await duplicateCampaign(database, ctx.organisationId, campaignId, ctx.userId);
    await recordAudit(database, ctx.organisationId, {
      actorUserId: ctx.userId,
      action: "campaign.duplicate",
      targetType: "campaign",
      targetId: copy.id,
      details: { sourceCampaignId: campaignId, name: copy.name },
    });
    revalidatePath("/campaigns");
    return { id: copy.id };
  });
}

export async function deleteCampaignAction(
  input: unknown,
): Promise<ActionResult<{ deleted: boolean }>> {
  return run("campaign.create", async (ctx) => {
    const { campaignId } = campaignRef.parse(input);
    const database = db();
    const deleted = await deleteCampaign(database, ctx.organisationId, campaignId);
    if (deleted) {
      await recordAudit(database, ctx.organisationId, {
        actorUserId: ctx.userId,
        action: "campaign.delete",
        targetType: "campaign",
        targetId: campaignId,
      });
    }
    revalidatePath("/campaigns");
    return { deleted };
  });
}

// ---------------------------------------------------------------------------
// Sender id groups
// ---------------------------------------------------------------------------

const createSidGroupInput = campaignRef.extend(sidGroupSchema.shape);

/** Create a group and make it the campaign's. Returns every group for the campaign country. */
export async function createSidGroupAction(
  input: unknown,
): Promise<ActionResult<{ groupId: string; groups: SidGroupView[] }>> {
  return run("campaign.create", async (ctx) => {
    const { campaignId, name, country } = createSidGroupInput.parse(input);
    const database = db();
    const group = await createSidGroup(database, ctx.organisationId, { name, country });
    await setCampaignSidGroup(database, ctx.organisationId, campaignId, group.id);
    revalidateCampaign(campaignId);
    const groups = await listSidGroups(database, ctx.organisationId, country);
    return { groupId: group.id, groups: groups.map((g) => toSidGroupView(g)) };
  });
}

const addSenderIdsInput = campaignRef.extend({ groupId: uuid, input: senderIdsInputSchema });

export async function addSenderIdsAction(
  input: unknown,
): Promise<ActionResult<{ added: number; skipped: number }>> {
  return run("campaign.create", async (ctx) => {
    const data = addSenderIdsInput.parse(input);
    const result = await addSenderIds(db(), ctx.organisationId, data.groupId, data.input);
    revalidateCampaign(data.campaignId);
    return { added: result.added, skipped: data.input.length - result.added };
  });
}

const toggleSenderIdInput = campaignRef.extend({ senderId: uuid, active: z.boolean() });

export async function toggleSenderIdAction(input: unknown): Promise<ActionResult<null>> {
  return run("campaign.create", async (ctx) => {
    const data = toggleSenderIdInput.parse(input);
    await toggleSenderId(db(), ctx.organisationId, data.senderId, data.active);
    revalidateCampaign(data.campaignId);
    return null;
  });
}

const setSidGroupInput = campaignRef.extend({ groupId: uuid });

export async function setCampaignSidGroupAction(input: unknown): Promise<ActionResult<null>> {
  return run("campaign.create", async (ctx) => {
    const data = setSidGroupInput.parse(input);
    await setCampaignSidGroup(db(), ctx.organisationId, data.campaignId, data.groupId);
    revalidateCampaign(data.campaignId);
    return null;
  });
}

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

const setListsInput = campaignRef.extend({ listIds: z.array(uuid) });

export async function setCampaignListsAction(input: unknown): Promise<ActionResult<null>> {
  return run("campaign.create", async (ctx) => {
    const data = setListsInput.parse(input);
    await setCampaignLists(db(), ctx.organisationId, data.campaignId, data.listIds);
    revalidateCampaign(data.campaignId);
    return null;
  });
}

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

const createLinkInput = campaignRef.extend(linkSchema.shape);

/** Create a link for the organisation and attach it to the campaign. */
export async function createLinkAction(input: unknown): Promise<ActionResult<{ linkId: string }>> {
  return run("campaign.create", async (ctx) => {
    const { campaignId, name, url, profitEur } = createLinkInput.parse(input);
    const database = db();
    const link = await createLink(database, ctx.organisationId, {
      name,
      url,
      profitMicro: BigInt(Math.round(profitEur * 1_000_000)),
    });
    await attachLink(database, ctx.organisationId, campaignId, link.id);
    revalidateCampaign(campaignId);
    return { linkId: link.id };
  });
}

const linkRef = campaignRef.extend({ linkId: uuid });

export async function attachLinkAction(input: unknown): Promise<ActionResult<null>> {
  return run("campaign.create", async (ctx) => {
    const data = linkRef.parse(input);
    await attachLink(db(), ctx.organisationId, data.campaignId, data.linkId);
    revalidateCampaign(data.campaignId);
    return null;
  });
}

const toggleLinkInput = linkRef.extend({ active: z.boolean() });

export async function toggleCampaignLinkAction(input: unknown): Promise<ActionResult<null>> {
  return run("campaign.create", async (ctx) => {
    const data = toggleLinkInput.parse(input);
    await toggleCampaignLink(db(), ctx.organisationId, data.campaignId, data.linkId, data.active);
    revalidateCampaign(data.campaignId);
    return null;
  });
}

export async function detachLinkAction(input: unknown): Promise<ActionResult<null>> {
  return run("campaign.create", async (ctx) => {
    const data = linkRef.parse(input);
    await detachLink(db(), ctx.organisationId, data.campaignId, data.linkId);
    revalidateCampaign(data.campaignId);
    return null;
  });
}

// ---------------------------------------------------------------------------
// Ad texts
// ---------------------------------------------------------------------------

const addAdTextsInput = campaignRef.extend({
  input: z.string().min(1, "Enter at least one text"),
  requireDomain: z.boolean().default(true),
});

function assertTexts(texts: string[], requireDomain: boolean): void {
  if (texts.length === 0) throw new Error("Enter at least one text");
  for (const text of texts) {
    adTextSchema.parse({ text });
    if (requireDomain && !hasDomainPlaceholder(text)) {
      throw new Error("Every text must contain {{domain}} (or switch the check off)");
    }
  }
}

export async function addAdTextsAction(input: unknown): Promise<ActionResult<{ added: number }>> {
  return run("campaign.create", async (ctx) => {
    const data = addAdTextsInput.parse(input);
    const texts = splitAdTexts(data.input);
    assertTexts(texts, data.requireDomain);
    const rows = await addAdTexts(db(), ctx.organisationId, data.campaignId, data.input);
    revalidateCampaign(data.campaignId);
    return { added: rows.length };
  });
}

const updateAdTextInput = campaignRef.extend({
  adTextId: uuid,
  text: z.string(),
  requireDomain: z.boolean().default(true),
});

export async function updateAdTextAction(input: unknown): Promise<ActionResult<AdTextView>> {
  return run("campaign.create", async (ctx) => {
    const data = updateAdTextInput.parse(input);
    const text = data.text.trim();
    assertTexts([text], data.requireDomain);
    const row = await updateAdText(db(), ctx.organisationId, data.adTextId, text);
    revalidateCampaign(data.campaignId);
    return {
      id: row.id,
      text: row.text,
      encoding: row.encoding,
      parts: row.parts,
      active: row.active,
      position: row.position,
    };
  });
}

const toggleAdTextInput = campaignRef.extend({ adTextId: uuid, active: z.boolean() });

export async function toggleAdTextAction(input: unknown): Promise<ActionResult<null>> {
  return run("campaign.create", async (ctx) => {
    const data = toggleAdTextInput.parse(input);
    await toggleAdText(db(), ctx.organisationId, data.adTextId, data.active);
    revalidateCampaign(data.campaignId);
    return null;
  });
}

// ---------------------------------------------------------------------------
// Send settings, estimate, send
// ---------------------------------------------------------------------------

const sendSettingsInput = z.intersection(campaignRef, sendSettingsSchema);

export async function updateSendSettingsAction(input: unknown): Promise<ActionResult<null>> {
  return run("campaign.create", async (ctx) => {
    const data = sendSettingsInput.parse(input);
    await updateSendSettings(db(), ctx.organisationId, data.campaignId, {
      testSize: data.testSize,
      contactReuse: data.contactReuse,
      sendNow: data.sendNow,
      ...(data.scheduledAt !== undefined ? { scheduledAt: data.scheduledAt } : {}),
      ...(data.autosender !== undefined ? { autosender: data.autosender } : {}),
      ...(data.autosenderMeasureMinutes !== undefined
        ? { autosenderMeasureMinutes: data.autosenderMeasureMinutes }
        : {}),
      ...(data.autosenderScaleFactor !== undefined
        ? { autosenderScaleFactor: data.autosenderScaleFactor }
        : {}),
      ...(data.autosenderCtrFloorPercent !== undefined
        ? { autosenderCtrFloorPercent: data.autosenderCtrFloorPercent }
        : {}),
    });
    revalidateCampaign(data.campaignId);
    return null;
  });
}

const sendOptionsInput = campaignRef.extend({
  routeIds: z.array(uuid),
  sendAll: z.boolean().default(false),
});

export async function estimateSendAction(input: unknown): Promise<ActionResult<EstimateView>> {
  return run("campaign.view", async (ctx) => {
    const data = sendOptionsInput.parse(input);
    const estimate = await estimateSend(db(), ctx.organisationId, data.campaignId, {
      routeIds: data.routeIds,
      sendAll: data.sendAll,
    });
    return toEstimateView(estimate);
  });
}

/** Queue the laps (see `createLaps` in `@sendex/db` for the contract the engine relies on). */
export async function sendCampaignAction(input: unknown): Promise<ActionResult<LapView[]>> {
  return run("campaign.send", async (ctx) => {
    const data = sendOptionsInput.parse(input);
    const rows = await createLaps(db(), ctx.organisationId, data.campaignId, {
      routeIds: data.routeIds,
      sendAll: data.sendAll,
      actorUserId: ctx.userId,
    });
    revalidateCampaign(data.campaignId);
    return rows.map((lap) => toLapView({ ...lap, routeName: "", listName: "", priceMicro: null }));
  });
}

// ---------------------------------------------------------------------------
// Results: lap on/off (D3-05)
// ---------------------------------------------------------------------------

const toggleLapInput = campaignRef.extend({ lapId: uuid, on: z.boolean() });

/**
 * The per-lap switch of the results table. Off cancels a queued or sending lap (its queued
 * messages are refunded); on re-queues a cancelled lap. `setLapOn` writes the `lap.toggle`
 * audit row on the campaign.
 */
export async function toggleLapAction(input: unknown): Promise<ActionResult<LapView>> {
  return run("campaign.send", async (ctx) => {
    const data = toggleLapInput.parse(input);
    const lap = await setLapOn(db(), ctx.organisationId, {
      lapId: data.lapId,
      on: data.on,
      actorUserId: ctx.userId,
    });
    if (lap.campaignId !== data.campaignId) throw new Error("Lap not found");
    revalidateCampaign(data.campaignId);
    return toLapView(lap);
  });
}

// ---------------------------------------------------------------------------
// Laps header and lap menu (D4-02): top-up, All switch, comment, reschedule, flush
// ---------------------------------------------------------------------------

const topUpInput = campaignRef.extend(topUpSchema.shape);

/** Add the amount to every active lap's budget (`topUpLaps` checks the balance and audits). */
export async function topUpLapsAction(
  input: unknown,
): Promise<ActionResult<{ laps: number; totalMicro: number; newSms: number }>> {
  return run("campaign.send", async (ctx) => {
    const data = topUpInput.parse(input);
    const result = await topUpLaps(db(), ctx.organisationId, {
      campaignId: data.campaignId,
      amountMicro: Math.round(data.amountEur * 1_000_000),
      actorUserId: ctx.userId,
    });
    revalidateCampaign(data.campaignId);
    return result;
  });
}

const allLapsInput = campaignRef.extend({ on: z.boolean() });

/** The All switch of the laps header. Returns how many laps were switched. */
export async function toggleAllLapsAction(input: unknown): Promise<ActionResult<number>> {
  return run("campaign.send", async (ctx) => {
    const data = allLapsInput.parse(input);
    const switched = await setAllLapsOn(db(), ctx.organisationId, {
      campaignId: data.campaignId,
      on: data.on,
      actorUserId: ctx.userId,
    });
    revalidateCampaign(data.campaignId);
    return switched;
  });
}

const lapRef = campaignRef.extend({ lapId: uuid });
const lapCommentInput = lapRef.extend(lapCommentSchema.shape);

export async function setLapCommentAction(input: unknown): Promise<ActionResult<null>> {
  return run("campaign.create", async (ctx) => {
    const data = lapCommentInput.parse(input);
    const lap = await setLapComment(db(), ctx.organisationId, {
      lapId: data.lapId,
      comment: data.comment,
      actorUserId: ctx.userId,
    });
    if (lap.campaignId !== data.campaignId) throw new Error("Lap not found");
    revalidateCampaign(data.campaignId);
    return null;
  });
}

const lapScheduleInput = lapRef.extend(lapScheduleSchema.shape);

export async function rescheduleLapAction(input: unknown): Promise<ActionResult<null>> {
  return run("campaign.send", async (ctx) => {
    const data = lapScheduleInput.parse(input);
    const lap = await rescheduleLap(db(), ctx.organisationId, {
      lapId: data.lapId,
      scheduledAt: new Date(data.scheduledAt),
      actorUserId: ctx.userId,
    });
    if (lap.campaignId !== data.campaignId) throw new Error("Lap not found");
    revalidateCampaign(data.campaignId);
    return null;
  });
}

/** Flush the lap's list so its contacts can be sent to again (`list.flush` role). */
export async function flushLapAction(
  input: unknown,
): Promise<ActionResult<{ listId: string; members: number }>> {
  return run("list.flush", async (ctx) => {
    const data = lapRef.parse(input);
    const result = await flushLap(db(), ctx.organisationId, {
      lapId: data.lapId,
      actorUserId: ctx.userId,
    });
    revalidateCampaign(data.campaignId);
    revalidatePath(`/lists/${result.listId}`);
    return result;
  });
}
