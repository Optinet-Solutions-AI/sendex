import type { AlertPayloadInput, CapReason, DailyCaps } from "@sendex/core";
import { and, eq, inArray, sql } from "drizzle-orm";
import { campaigns, laps } from "../schema/campaigns.js";
import { auditLog } from "../schema/core.js";
import type { Db } from "../types.js";
import { type RaiseAlertResult, raiseAlert } from "./alerts.js";
import { getSettings } from "./settings.js";
import { type DailyUsage, dailyUsage } from "./usage.js";

/**
 * Everything the send loop needs to enforce the daily caps (D3-11), separate from
 * `SendingStore` so the loop can be tested with an in-memory fake
 * (apps/worker/src/send/caps.fake.ts) and the SQL on PGlite (caps.test.ts).
 */

export interface LapRefusalInput {
  lapId: string;
  organisationId: string;
  /** Messages the lap wanted to send and will not; added to `laps.refused`. */
  refused: number;
  reason: CapReason;
}

export interface PauseCampaignInput {
  campaignId: string;
  organisationId: string;
  /** Stored on the audit row with `by: "worker"`. */
  reason: string;
  details: Record<string, unknown>;
}

export interface CapsStore {
  getDailyCaps(organisationId: string): Promise<DailyCaps>;
  getDailyUsage(organisationId: string, dayStartUtc: Date): Promise<DailyUsage>;
  /** Add to the lap's refused count and record why. */
  recordLapRefusal(input: LapRefusalInput): Promise<void>;
  /**
   * Pause a `sending` or `scheduled` campaign with an audit row `campaign.pause`, so the owner
   * can raise the cap and resume. Returns false when the status did not change.
   */
  pauseCampaign(input: PauseCampaignInput): Promise<boolean>;
  raiseAlert(organisationId: string, payload: AlertPayloadInput): Promise<RaiseAlertResult>;
}

export function createCapsStore(db: Db): CapsStore {
  return {
    async getDailyCaps(organisationId) {
      const settings = await getSettings(db, organisationId);
      return {
        dailyMessageCap: settings.dailyMessageCap,
        dailySpendCapMicro: settings.dailySpendCapMicro,
      };
    },

    getDailyUsage: (organisationId, dayStartUtc) => dailyUsage(db, organisationId, dayStartUtc),

    async recordLapRefusal({ lapId, organisationId, refused, reason }) {
      await db
        .update(laps)
        .set({ refused: sql`${laps.refused} + ${refused}`, refusalReason: reason })
        .where(and(eq(laps.id, lapId), eq(laps.organisationId, organisationId)));
    },

    async pauseCampaign({ campaignId, organisationId, reason, details }) {
      return db.transaction(async (tx) => {
        const [row] = await tx
          .update(campaigns)
          .set({ status: "paused", updatedAt: new Date() })
          .where(
            and(
              eq(campaigns.id, campaignId),
              eq(campaigns.organisationId, organisationId),
              inArray(campaigns.status, ["sending", "scheduled"]),
            ),
          )
          .returning({ id: campaigns.id });
        if (!row) return false;
        await tx.insert(auditLog).values({
          organisationId,
          action: "campaign.pause",
          targetType: "campaign",
          targetId: campaignId,
          details: { reason, by: "worker", ...details },
        });
        return true;
      });
    },

    raiseAlert: (organisationId, payload) => raiseAlert(db, organisationId, payload),
  };
}
