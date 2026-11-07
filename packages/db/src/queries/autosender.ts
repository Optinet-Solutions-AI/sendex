import type { AutosenderLap } from "@sendex/core";
import { and, asc, eq, exists, isNull, notInArray, sql } from "drizzle-orm";
import { campaignLists, campaigns, laps } from "../schema/campaigns.js";
import { auditLog } from "../schema/core.js";
import type { Db } from "../types.js";
import { type ContactReuse, createSendingStore } from "./sending.js";

/**
 * What the worker's AutoSender tick reads and writes (D4-02). The decision itself is
 * `autosenderDecision` in `@sendex/core`; this store only feeds it and records what it did.
 */

export interface AutosenderCampaign {
  id: string;
  organisationId: string;
  testSize: number;
  contactReuse: ContactReuse;
  measureMinutes: number;
  scaleFactor: number;
  ctrFloorPercent: number;
}

export interface ScaleOutInput {
  campaign: AutosenderCampaign;
  routeId: string;
  laps: ReadonlyArray<{ listId: string; count: number }>;
  testCtr: number;
}

export interface AutosenderStore {
  /** Campaigns with AutoSender on, not stopped by it, not paused or stopped, with at least one lap. */
  listAutosenderCampaigns(): Promise<AutosenderCampaign[]>;
  listLaps(campaignId: string): Promise<AutosenderLap[]>;
  /** Contacts still eligible per list of the campaign, under its contact reuse rule. */
  availableByList(
    campaign: AutosenderCampaign,
  ): Promise<Array<{ listId: string; available: number }>>;
  /** Queue one scale-out lap per list on the winning route, flagged `autosender`, with an audit row. */
  createScaleLaps(input: ScaleOutInput): Promise<string[]>;
  /** AutoSender is done with this campaign: stamp the reason so the tick leaves it alone. */
  stop(input: { campaignId: string; organisationId: string; reason: string }): Promise<void>;
}

export function createAutosenderStore(db: Db): AutosenderStore {
  const sending = createSendingStore(db);
  return {
    listAutosenderCampaigns() {
      return db
        .select({
          id: campaigns.id,
          organisationId: campaigns.organisationId,
          testSize: campaigns.testSize,
          contactReuse: campaigns.contactReuse,
          measureMinutes: campaigns.autosenderMeasureMinutes,
          scaleFactor: campaigns.autosenderScaleFactor,
          ctrFloorPercent: campaigns.autosenderCtrFloorPercent,
        })
        .from(campaigns)
        .where(
          and(
            eq(campaigns.autosender, true),
            isNull(campaigns.autosenderStoppedAt),
            notInArray(campaigns.status, ["draft", "paused", "stopped", "completed"]),
            exists(db.select({ one: sql`1` }).from(laps).where(eq(laps.campaignId, campaigns.id))),
          ),
        )
        .orderBy(asc(campaigns.createdAt));
    },

    async listLaps(campaignId) {
      const rows = await db
        .select({
          id: laps.id,
          routeId: laps.routeId,
          listId: laps.listId,
          status: laps.status,
          scale: laps.autosender,
          sent: laps.sent,
          clicks: laps.clicks,
          costMicro: laps.costMicro,
          startedAt: laps.startedAt,
          finishedAt: laps.finishedAt,
        })
        .from(laps)
        .where(eq(laps.campaignId, campaignId))
        .orderBy(asc(laps.createdAt), asc(laps.id));
      return rows.map((r) => ({ ...r, costMicro: Number(r.costMicro) }));
    },

    async availableByList(campaign) {
      const listRows = await db
        .select({ listId: campaignLists.listId })
        .from(campaignLists)
        .where(eq(campaignLists.campaignId, campaign.id));
      const out: Array<{ listId: string; available: number }> = [];
      for (const { listId } of listRows) {
        const available = await sending.countEligibleMembers({
          organisationId: campaign.organisationId,
          listId,
          campaignId: campaign.id,
          contactReuse: campaign.contactReuse,
        });
        out.push({ listId, available });
      }
      return out;
    },

    async createScaleLaps(input) {
      return db.transaction(async (tx) => {
        const ids: string[] = [];
        const created: Array<{ lapId: string; listId: string; count: number }> = [];
        for (const plan of input.laps) {
          const [lap] = await tx
            .insert(laps)
            .values({
              organisationId: input.campaign.organisationId,
              campaignId: input.campaign.id,
              listId: plan.listId,
              routeId: input.routeId,
              testSize: plan.count,
              status: "queued",
              autosender: true,
            })
            .returning({ id: laps.id });
          if (!lap) throw new Error("lap insert returned no row");
          ids.push(lap.id);
          created.push({ lapId: lap.id, listId: plan.listId, count: plan.count });
        }
        await tx.insert(auditLog).values({
          organisationId: input.campaign.organisationId,
          action: "autosender.scale",
          targetType: "campaign",
          targetId: input.campaign.id,
          details: { routeId: input.routeId, laps: created, testCtr: input.testCtr },
        });
        return ids;
      });
    },

    async stop({ campaignId, organisationId, reason }) {
      await db.transaction(async (tx) => {
        await tx
          .update(campaigns)
          .set({ autosenderStoppedAt: new Date(), autosenderStopReason: reason })
          .where(and(eq(campaigns.id, campaignId), eq(campaigns.organisationId, organisationId)));
        await tx.insert(auditLog).values({
          organisationId,
          action: "autosender.stop",
          targetType: "campaign",
          targetId: campaignId,
          details: { reason },
        });
      });
    },
  };
}
