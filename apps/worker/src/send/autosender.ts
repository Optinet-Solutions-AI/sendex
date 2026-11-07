import { autosenderDecision } from "@sendex/core";
import type { AutosenderStore } from "@sendex/db";
import type { Logger } from "../log.js";

/**
 * The AutoSender tick (D4-02), riding on the dispatcher tick: for every campaign with
 * AutoSender on, ask `autosenderDecision` what to do with its laps and act on it. The laps
 * it queues are picked up by the next dispatcher tick like any other lap.
 */

export interface AutosenderDeps {
  store: AutosenderStore;
  log: Logger;
  now?: () => Date;
}

export interface AutosenderTickResult {
  campaigns: number;
  scaled: number;
  stopped: number;
  waiting: number;
  failed: number;
}

export async function runAutosenderTick(deps: AutosenderDeps): Promise<AutosenderTickResult> {
  const now = deps.now?.() ?? new Date();
  const result: AutosenderTickResult = {
    campaigns: 0,
    scaled: 0,
    stopped: 0,
    waiting: 0,
    failed: 0,
  };
  const campaigns = await deps.store.listAutosenderCampaigns();
  result.campaigns = campaigns.length;
  for (const campaign of campaigns) {
    const fields = { campaignId: campaign.id, organisationId: campaign.organisationId };
    try {
      const [laps, available] = await Promise.all([
        deps.store.listLaps(campaign.id),
        deps.store.availableByList(campaign),
      ]);
      const decision = autosenderDecision({
        now,
        settings: {
          testSize: campaign.testSize,
          measureMinutes: campaign.measureMinutes,
          scaleFactor: campaign.scaleFactor,
          ctrFloorPercent: campaign.ctrFloorPercent,
        },
        laps,
        available,
      });
      if (decision.action === "scale") {
        const ids = await deps.store.createScaleLaps({
          campaign,
          routeId: decision.routeId,
          laps: decision.laps,
          testCtr: decision.testCtr,
        });
        result.scaled += 1;
        deps.log("info", "autosender scaled out", {
          ...fields,
          routeId: decision.routeId,
          laps: ids.length,
          messages: decision.laps.reduce((sum, l) => sum + l.count, 0),
          testCtr: decision.testCtr,
        });
      } else if (decision.action === "stop") {
        await deps.store.stop({ ...fields, reason: decision.reason });
        result.stopped += 1;
        deps.log("info", "autosender stopped", { ...fields, reason: decision.reason });
      } else {
        result.waiting += 1;
      }
    } catch (err) {
      result.failed += 1;
      deps.log("error", "autosender tick failed for campaign", { ...fields, err });
    }
  }
  return result;
}
