import type { AlertPayload, DailyCaps } from "@sendex/core";
import { alertPayloadSchema } from "@sendex/core";
import type {
  AlertRow,
  CapsStore,
  DailyUsage,
  LapRefusalInput,
  PauseCampaignInput,
} from "@sendex/db";

/**
 * In-memory `CapsStore` for unit tests of the send loop and the scheduler checks. Usage is
 * read through a callback so a test can derive it from the fake sending store's messages.
 * The real SQL is covered by packages/db/src/queries/caps.test.ts.
 */

export interface FakeCapsOptions {
  caps?: Partial<DailyCaps>;
  /** Today's usage; defaults to nothing sent. */
  usage?: () => DailyUsage;
}

export interface FakeAlert extends AlertPayload {
  id: string;
  organisationId: string;
}

export interface FakeCapsStore extends CapsStore {
  caps: DailyCaps;
  refusals: LapRefusalInput[];
  pauses: PauseCampaignInput[];
  alerts: FakeAlert[];
  /** Campaign ids currently paused by this fake (so a second pause returns false). */
  pausedCampaigns: Set<string>;
}

let counter = 0;

export function createFakeCapsStore(options: FakeCapsOptions = {}): FakeCapsStore {
  const caps: DailyCaps = {
    dailyMessageCap: options.caps?.dailyMessageCap ?? null,
    dailySpendCapMicro: options.caps?.dailySpendCapMicro ?? null,
  };
  const usage = options.usage ?? (() => ({ messages: 0, spentMicro: 0n }));
  const refusals: LapRefusalInput[] = [];
  const pauses: PauseCampaignInput[] = [];
  const alerts: FakeAlert[] = [];
  const pausedCampaigns = new Set<string>();

  function toRow(alert: FakeAlert): AlertRow {
    return {
      id: alert.id,
      organisationId: alert.organisationId,
      kind: alert.kind,
      periodKey: alert.periodKey,
      message: alert.message,
      details: alert.details,
      raisedAt: new Date(),
      acknowledgedAt: null,
      acknowledgedBy: null,
    };
  }

  return {
    caps,
    refusals,
    pauses,
    alerts,
    pausedCampaigns,
    async getDailyCaps() {
      return { ...caps };
    },
    async getDailyUsage() {
      return usage();
    },
    async recordLapRefusal(input) {
      refusals.push(input);
    },
    async pauseCampaign(input) {
      pauses.push(input);
      if (pausedCampaigns.has(input.campaignId)) return false;
      pausedCampaigns.add(input.campaignId);
      return true;
    },
    async raiseAlert(organisationId, payload) {
      const parsed = alertPayloadSchema.parse(payload);
      const existing = alerts.find(
        (a) =>
          a.organisationId === organisationId &&
          a.kind === parsed.kind &&
          a.periodKey === parsed.periodKey,
      );
      if (existing) return { alert: toRow(existing), created: false };
      counter += 1;
      const alert: FakeAlert = { id: `alert-${counter}`, organisationId, ...parsed };
      alerts.push(alert);
      return { alert: toRow(alert), created: true };
    },
  };
}
