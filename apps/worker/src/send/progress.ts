import type { CampaignLapRow } from "@sendex/db";

/** The slice of ioredis the send loop uses, so tests can pass an in-memory fake. */
export interface SendRedis {
  get(key: string): Promise<string | null>;
  set(key: string, value: string | number): Promise<unknown>;
  incrby(key: string, increment: number): Promise<number>;
  mget(...keys: string[]): Promise<(string | null)[]>;
  expire(key: string, seconds: number): Promise<unknown>;
}

/** Counter keys the web app may read directly; documented in sending-engine.md. */
export const progressKeys = {
  lap: (lapId: string) => ({
    sent: `sendex:lap:${lapId}:sent`,
    failed: `sendex:lap:${lapId}:failed`,
    total: `sendex:lap:${lapId}:total`,
  }),
  campaign: (campaignId: string) => ({
    sent: `sendex:campaign:${campaignId}:sent`,
    failed: `sendex:campaign:${campaignId}:failed`,
    total: `sendex:campaign:${campaignId}:total`,
  }),
  /** Emergency stop flag for an organisation (set by D2-10); any value stops sending. */
  stop: (organisationId: string) => `sendex:stop:${organisationId}`,
};

export interface LapProgress {
  lapId: string;
  status: CampaignLapRow["status"];
  sent: number;
  failed: number;
  total: number;
}

export interface CampaignProgress {
  campaignId: string;
  sent: number;
  failed: number;
  total: number;
  laps: LapProgress[];
}

export interface ProgressTracker {
  /** Set a lap's planned total (idempotent) and keep the campaign total in step. */
  setLapTotal(campaignId: string, lapId: string, total: number): Promise<void>;
  recordBatch(
    campaignId: string,
    lapId: string,
    counts: { sent: number; failed: number },
  ): Promise<void>;
  /** Live numbers per lap from Redis, with the lap rows as fallback when a key has expired. */
  readCampaign(campaignId: string, laps: readonly CampaignLapRow[]): Promise<CampaignProgress>;
}

export interface ProgressOptions {
  /** Counters expire this long after their last update. Default 7 days. */
  ttlSeconds?: number;
}

const DEFAULT_TTL_SECONDS = 7 * 24 * 3600;

export function createProgressTracker(
  redis: SendRedis,
  options: ProgressOptions = {},
): ProgressTracker {
  const ttl = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;

  async function touch(...keys: string[]): Promise<void> {
    await Promise.all(keys.map((k) => redis.expire(k, ttl)));
  }

  return {
    async setLapTotal(campaignId, lapId, total) {
      const lap = progressKeys.lap(lapId);
      const campaign = progressKeys.campaign(campaignId);
      const previous = Number((await redis.get(lap.total)) ?? "0");
      await redis.set(lap.total, total);
      if (total !== previous) await redis.incrby(campaign.total, total - previous);
      await touch(lap.total, campaign.total);
    },

    async recordBatch(campaignId, lapId, counts) {
      const lap = progressKeys.lap(lapId);
      const campaign = progressKeys.campaign(campaignId);
      const ops: Promise<unknown>[] = [];
      if (counts.sent > 0) {
        ops.push(redis.incrby(lap.sent, counts.sent), redis.incrby(campaign.sent, counts.sent));
      }
      if (counts.failed > 0) {
        ops.push(
          redis.incrby(lap.failed, counts.failed),
          redis.incrby(campaign.failed, counts.failed),
        );
      }
      await Promise.all(ops);
      await touch(lap.sent, lap.failed, campaign.sent, campaign.failed);
    },

    async readCampaign(campaignId, laps) {
      const keys = laps.flatMap((l) => {
        const k = progressKeys.lap(l.id);
        return [k.sent, k.failed, k.total];
      });
      const values = keys.length === 0 ? [] : await redis.mget(...keys);
      const read = (index: number, fallback: number): number => {
        const raw = values[index];
        return raw === null || raw === undefined ? fallback : Number(raw);
      };
      const lapProgress: LapProgress[] = laps.map((l, i) => ({
        lapId: l.id,
        status: l.status,
        sent: read(i * 3, l.sent),
        failed: read(i * 3 + 1, l.failed),
        total: read(i * 3 + 2, l.testSize),
      }));
      return {
        campaignId,
        sent: lapProgress.reduce((n, l) => n + l.sent, 0),
        failed: lapProgress.reduce((n, l) => n + l.failed, 0),
        total: lapProgress.reduce((n, l) => n + l.total, 0),
        laps: lapProgress,
      };
    },
  };
}
