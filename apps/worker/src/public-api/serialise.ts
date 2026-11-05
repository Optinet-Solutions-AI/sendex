import type {
  ApiCampaign,
  ApiCampaignStatusResponse,
  ApiCampaignSummary,
  ApiCounters,
  ApiLap,
  ApiList,
  ApiListDetail,
} from "@sendex/core";
import type {
  CampaignDetail,
  CampaignSummary,
  LapSummary,
  ListDetail,
  ListSummaryRow,
} from "@sendex/db";
import type { CampaignProgress } from "../send/progress.js";

/** JSON-safe views of the db rows: dates as ISO strings, int8 as decimal strings. */

const iso = (value: Date): string => value.toISOString();
const isoOrNull = (value: Date | null): string | null => (value === null ? null : iso(value));

export function toApiList(row: ListSummaryRow): ApiList {
  return {
    id: row.id,
    name: row.name,
    country: row.country,
    numbersCount: row.numbersCount,
    sent: row.sent,
    lastSentAt: isoOrNull(row.lastSentAt),
    lastUploadAt: isoOrNull(row.lastUploadAt),
    createdAt: iso(row.createdAt),
  };
}

export function toApiListDetail(row: ListDetail): ApiListDetail {
  return {
    id: row.id,
    name: row.name,
    country: row.country,
    numbersCount: row.numbersCount,
    sent: row.counts.sent,
    lastSentAt: isoOrNull(row.lastSentAt),
    lastUploadAt: isoOrNull(row.lastUploadAt),
    createdAt: iso(row.createdAt),
    counts: row.counts,
  };
}

export function toApiCampaignSummary(row: CampaignSummary): ApiCampaignSummary {
  return {
    id: row.id,
    name: row.name,
    country: row.country,
    timezone: row.timezone,
    status: row.status,
    createdAt: iso(row.createdAt),
    lapsCount: row.lapsCount,
    sent: row.sent,
    clicks: row.clicks,
    ctr: row.ctr,
    costMicro: row.costMicro.toString(),
    leads: row.leads,
    sales: row.sales,
    firstLapAt: isoOrNull(row.firstLapAt),
    lastLapAt: isoOrNull(row.lastLapAt),
  };
}

export function toApiLap(lap: LapSummary): ApiLap {
  return {
    id: lap.id,
    listId: lap.listId,
    listName: lap.listName,
    routeId: lap.routeId,
    routeName: lap.routeName,
    status: lap.status,
    testSize: lap.testSize,
    sent: lap.sent,
    delivered: lap.delivered,
    failed: lap.failed,
    clicks: lap.clicks,
    leads: lap.leads,
    sales: lap.sales,
    costMicro: lap.costMicro.toString(),
    revenueMicro: lap.revenueMicro.toString(),
    rank: lap.rank,
    startedAt: isoOrNull(lap.startedAt),
    finishedAt: isoOrNull(lap.finishedAt),
    createdAt: iso(lap.createdAt),
  };
}

/** Lap counters summed over the campaign (the denormalised columns, not the live Redis numbers). */
export function sumCounters(laps: readonly LapSummary[]): ApiCounters {
  let costMicro = 0n;
  let revenueMicro = 0n;
  const totals = { sent: 0, delivered: 0, failed: 0, clicks: 0, leads: 0, sales: 0 };
  for (const lap of laps) {
    totals.sent += lap.sent;
    totals.delivered += lap.delivered;
    totals.failed += lap.failed;
    totals.clicks += lap.clicks;
    totals.leads += lap.leads;
    totals.sales += lap.sales;
    costMicro += lap.costMicro;
    revenueMicro += lap.revenueMicro;
  }
  return { ...totals, costMicro: costMicro.toString(), revenueMicro: revenueMicro.toString() };
}

export function toApiCampaign(detail: CampaignDetail): ApiCampaign {
  return {
    id: detail.id,
    name: detail.name,
    country: detail.country,
    timezone: detail.timezone,
    status: detail.status,
    contactReuse: detail.contactReuse,
    testSize: detail.testSize,
    scheduledAt: isoOrNull(detail.scheduledAt),
    createdAt: iso(detail.createdAt),
    updatedAt: iso(detail.updatedAt),
    lists: detail.lists.map((l) => ({
      id: l.id,
      name: l.name,
      country: l.country,
      numbersCount: l.numbersCount,
      available: l.available,
    })),
    senderIds: (detail.sidGroup?.senderIds ?? []).filter((s) => s.active).map((s) => s.value),
    adTexts: detail.adTexts.map((t) => ({
      id: t.id,
      text: t.text,
      encoding: t.encoding,
      parts: t.parts,
      active: t.active,
    })),
    links: detail.links.map((l) => ({ id: l.id, name: l.name, url: l.url, active: l.active })),
    laps: detail.laps.map(toApiLap),
    counters: sumCounters(detail.laps),
  };
}

export function toApiStatus(
  detail: CampaignDetail,
  progress: CampaignProgress,
): ApiCampaignStatusResponse {
  return {
    id: detail.id,
    status: detail.status,
    scheduledAt: isoOrNull(detail.scheduledAt),
    progress: {
      sent: progress.sent,
      failed: progress.failed,
      total: progress.total,
      laps: progress.laps.map((l) => ({
        lapId: l.lapId,
        status: l.status,
        sent: l.sent,
        failed: l.failed,
        total: l.total,
      })),
    },
    counters: sumCounters(detail.laps),
  };
}
