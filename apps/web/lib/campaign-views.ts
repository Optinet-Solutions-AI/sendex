import type {
  AuditRow,
  CampaignDetail,
  CampaignListSummary,
  CampaignMessagesPage,
  CampaignResults,
  CampaignSummary,
  LapSummary,
  LinkRow,
  RouteOption,
  RoutePerformance,
  SendEstimate,
  SidGroupWithIds,
} from "@sendex/db";
import type {
  AuditView,
  CampaignMessagesView,
  CampaignResultsView,
  CampaignSummaryView,
  CampaignView,
  EstimateView,
  LapView,
  LinkOption,
  ListOption,
  ResultRatesView,
  RoutePerformanceView,
  RouteView,
  SidGroupView,
} from "../components/campaigns/types";

/** Database rows to the serialisable views the client components take. */

function iso(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}

export function toListOption(list: CampaignListSummary): ListOption {
  return {
    id: list.id,
    name: list.name,
    country: list.country,
    numbersCount: list.numbersCount,
    available: list.available,
    sent: list.sent,
    bad: list.bad,
  };
}

export function toSidGroupView(
  group: SidGroupWithIds,
  stats?: { sent: number; clicks: number },
): SidGroupView {
  return {
    id: group.id,
    name: group.name,
    country: group.country,
    senderIds: group.senderIds.map((s) => ({ id: s.id, value: s.value, active: s.active })),
    activeCount: group.activeCount,
    sent: stats?.sent ?? 0,
    clicks: stats?.clicks ?? 0,
  };
}

export function toLinkOption(link: LinkRow): LinkOption {
  return { id: link.id, name: link.name, url: link.url, profitMicro: Number(link.profitMicro) };
}

export function toRouteView(route: RouteOption): RouteView {
  return {
    id: route.id,
    name: route.name,
    provider: route.provider,
    platform: route.platform,
    priceMicro: route.priceMicro === null ? null : Number(route.priceMicro),
  };
}

export function toLapView(lap: LapSummary): LapView {
  return {
    id: lap.id,
    routeId: lap.routeId,
    routeName: lap.routeName,
    listId: lap.listId,
    listName: lap.listName,
    segmentName: lap.segmentName,
    testSize: lap.testSize,
    status: lap.status,
    sent: lap.sent,
    delivered: lap.delivered,
    failed: lap.failed,
    clicks: lap.clicks,
    leads: lap.leads,
    sales: lap.sales,
    costMicro: Number(lap.costMicro),
    rank: lap.rank,
    refused: lap.refused,
    refusalReason: lap.refusalReason,
    startedAt: iso(lap.startedAt),
    finishedAt: iso(lap.finishedAt),
    createdAt: lap.createdAt.toISOString(),
    priceMicro: lap.priceMicro === null ? null : Number(lap.priceMicro),
    budgetMicro: Number(lap.budgetMicro),
    previews: lap.previews,
    comment: lap.comment,
    active: lap.active,
    scheduledAt: iso(lap.scheduledAt),
    autosender: lap.autosender,
  };
}

export function toCampaignView(
  detail: CampaignDetail,
  sidStats?: { sent: number; clicks: number },
): CampaignView {
  return {
    id: detail.id,
    name: detail.name,
    country: detail.country,
    timezone: detail.timezone,
    status: detail.status,
    contactReuse: detail.contactReuse,
    testSize: detail.testSize,
    autosender: detail.autosender,
    autosenderMeasureMinutes: detail.autosenderMeasureMinutes,
    autosenderScaleFactor: detail.autosenderScaleFactor,
    autosenderCtrFloorPercent: detail.autosenderCtrFloorPercent,
    autosenderStopReason: detail.autosenderStopReason,
    scheduledAt: iso(detail.scheduledAt),
    createdAt: detail.createdAt.toISOString(),
    updatedAt: detail.updatedAt.toISOString(),
    lists: detail.lists.map(toListOption),
    segments: detail.segments.map((seg) => ({
      id: seg.id,
      name: seg.name,
      summary: seg.summary,
      size: seg.size,
      good: seg.good,
      available: seg.available,
    })),
    sidGroup: detail.sidGroup ? toSidGroupView(detail.sidGroup, sidStats) : null,
    adTexts: detail.adTexts.map((t) => ({
      id: t.id,
      text: t.text,
      encoding: t.encoding,
      parts: t.parts,
      active: t.active,
      position: t.position,
    })),
    links: detail.links.map((l) => ({
      id: l.id,
      name: l.name,
      url: l.url,
      active: l.active,
      profitMicro: Number(l.profitMicro),
    })),
    laps: detail.laps.map(toLapView),
  };
}

export function toEstimateView(estimate: SendEstimate): EstimateView {
  return {
    contacts: estimate.contacts,
    sids: estimate.sids,
    texts: estimate.texts,
    links: estimate.links,
    testSize: estimate.testSize,
    sendAll: estimate.sendAll,
    smsCount: estimate.smsCount,
    costMicro: Number(estimate.costMicro),
    laps: estimate.laps.map((lap) => ({ ...lap })),
  };
}

export function toAuditView(row: AuditRow): AuditView {
  return {
    id: row.id,
    action: row.action,
    actorUserId: row.actorUserId,
    details: row.details,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toCampaignSummaryView(row: CampaignSummary): CampaignSummaryView {
  return {
    id: row.id,
    name: row.name,
    country: row.country,
    timezone: row.timezone,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    lapsCount: row.lapsCount,
    sent: row.sent,
    clicks: row.clicks,
    ctr: row.ctr,
    costMicro: Number(row.costMicro),
    leads: row.leads,
    sales: row.sales,
    firstLapAt: iso(row.firstLapAt),
    lastLapAt: iso(row.lastLapAt),
  };
}

function micro(value: bigint | null): number | null {
  return value === null ? null : Number(value);
}

function toRatesView(rates: {
  ctr: number;
  deliveryRate: number;
  failureRate: number;
  cpcMicro: bigint | null;
  cplMicro: bigint | null;
  cpsMicro: bigint | null;
}): ResultRatesView {
  return {
    ctr: rates.ctr,
    deliveryRate: rates.deliveryRate,
    failureRate: rates.failureRate,
    cpcMicro: micro(rates.cpcMicro),
    cplMicro: micro(rates.cplMicro),
    cpsMicro: micro(rates.cpsMicro),
  };
}

export function toResultsView(results: CampaignResults): CampaignResultsView {
  const t = results.totals;
  return {
    campaignId: results.campaignId,
    firstSentAt: iso(results.firstSentAt),
    lastSentAt: iso(results.lastSentAt),
    totals: {
      sent: t.sent,
      delivered: t.delivered,
      failed: t.failed,
      clicks: t.clicks,
      leads: t.leads,
      sales: t.sales,
      costMicro: Number(t.costMicro),
      revenueMicro: Number(t.revenueMicro),
      ...toRatesView(t),
    },
    laps: results.laps.map((lap) => ({ ...toLapView(lap), ...toRatesView(lap), on: lap.on })),
    networks: {
      source: results.networks.source,
      rows: results.networks.rows.map((r) => ({ ...r, costMicro: Number(r.costMicro) })),
    },
    clicksPerHour: results.clicksPerHour.map((h) => ({
      hour: h.hour,
      at: h.at.toISOString(),
      clicks: h.clicks,
    })),
    clicksPerLink: results.clicksPerLink.map((l) => ({ ...l })),
  };
}

export function toMessagesView(page: CampaignMessagesPage): CampaignMessagesView {
  return {
    rows: page.rows.map((m) => ({
      id: m.id,
      at: (m.sentAt ?? m.createdAt).toISOString(),
      lapId: m.lapId,
      routeName: m.routeName,
      senderId: m.senderId,
      recipient: m.recipient,
      text: m.text,
      status: m.status,
      errorCode: m.errorCode,
      clicked: m.clicked,
    })),
    total: page.total,
    page: page.page,
    pageSize: page.pageSize,
  };
}

const nullableMicro = (v: bigint | null): number | null => (v === null ? null : Number(v));

export function toRoutePerformanceView(perf: RoutePerformance): RoutePerformanceView {
  const periods = ["daily", "weekly", "monthly"] as const;
  const platform = {} as RoutePerformanceView["platform"];
  const account = {} as RoutePerformanceView["account"];
  for (const period of periods) {
    platform[period] = perf.platform[period].map((r) => ({
      routeId: r.routeId,
      name: r.name,
      priceMicro: nullableMicro(r.priceMicro),
      ctrRank: r.ctrRank,
      cpcRank: r.cpcRank,
      overallRank: r.overallRank,
    }));
    account[period] = perf.account[period].map((r) => ({
      routeId: r.routeId,
      name: r.name,
      priceMicro: nullableMicro(r.priceMicro),
      costMicro: Number(r.costMicro),
      sent: r.sent,
      clicks: r.clicks,
      ctr: r.ctr,
      cpcMicro: nullableMicro(r.cpcMicro),
    }));
  }
  return { country: perf.country, platform, account };
}
