/**
 * Serialisable views of the campaign data passed from server components and actions to the
 * client: dates as ISO strings, micro-EUR as numbers (safe well beyond any real balance).
 */
import type { ContactReuse } from "@sendex/core";

export type CampaignStatus = "draft" | "scheduled" | "sending" | "paused" | "stopped" | "completed";

export type LapStatus = "queued" | "sending" | "done" | "cancelled";

export interface ListOption {
  id: string;
  name: string;
  country: string;
  numbersCount: number;
  /** Members that can still be messaged. */
  available: number;
  /** Members messaged since the last flush. */
  sent: number;
  /** Members flagged bad. */
  bad: number;
}

export interface SenderIdView {
  id: string;
  value: string;
  active: boolean;
}

export interface SidGroupView {
  id: string;
  name: string;
  country: string;
  senderIds: SenderIdView[];
  activeCount: number;
  /** Messages accepted with a sender id of the group, across campaigns. */
  sent: number;
  /** Messages of the group that were clicked. */
  clicks: number;
}

export interface AdTextView {
  id: string;
  text: string;
  encoding: string;
  parts: number;
  active: boolean;
  position: number;
}

/** An offer (SMS Edge's word for a tracked link) attached to the campaign. */
export interface CampaignLinkView {
  id: string;
  name: string;
  url: string;
  active: boolean;
  profitMicro: number;
}

export interface LinkOption {
  id: string;
  name: string;
  url: string;
  profitMicro: number;
}

export interface RouteView {
  id: string;
  name: string;
  provider: string;
  platform: boolean;
  priceMicro: number | null;
}

/** A segment attached to the campaign as an audience. */
export interface CampaignSegmentView {
  id: string;
  name: string;
  summary: string;
  size: number | null;
  good: number | null;
  /** Matching contacts of the campaign country's lists that can still be sent to. */
  available: number;
}

/** A segment the organisation can pick as an audience. */
export interface SegmentOption {
  id: string;
  name: string;
  summary: string;
  size: number | null;
  good: number | null;
}

export interface LapView {
  id: string;
  routeId: string;
  routeName: string;
  listId: string;
  listName: string;
  /** The segment the lap was planned from, when it was. */
  segmentName: string | null;
  testSize: number;
  status: LapStatus;
  sent: number;
  delivered: number;
  failed: number;
  clicks: number;
  leads: number;
  sales: number;
  costMicro: number;
  rank: number | null;
  /** Messages a daily cap refused (D3-11), with the cap that bound. */
  refused: number;
  refusalReason: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  /** The route's price per SMS for the lap's country; null when unpriced. */
  priceMicro: number | null;
  /** Micro-EUR added by budget top-ups. */
  budgetMicro: number;
  /** Link-preview bot hits, never counted as clicks. */
  previews: number;
  comment: string | null;
  /** The On switch. */
  active: boolean;
  /** A rescheduled lap waits until this time. */
  scheduledAt: string | null;
  /** True for the scale-out laps AutoSender created. */
  autosender: boolean;
}

export interface CampaignView {
  id: string;
  /** SMS parts billed per message: the longest active text as sent (`campaignMessageParts`). */
  partsPerMessage: number;
  name: string;
  country: string;
  timezone: string;
  status: CampaignStatus;
  contactReuse: ContactReuse;
  testSize: number;
  autosender: boolean;
  autosenderMeasureMinutes: number;
  autosenderScaleFactor: number;
  autosenderCtrFloorPercent: number;
  /** Why AutoSender stopped on its own, null while it runs or never ran. */
  autosenderStopReason: string | null;
  scheduledAt: string | null;
  createdAt: string;
  updatedAt: string;
  lists: ListOption[];
  segments: CampaignSegmentView[];
  sidGroup: SidGroupView | null;
  adTexts: AdTextView[];
  links: CampaignLinkView[];
  laps: LapView[];
  /** Routes saved on the send form, in the order they were picked (D4-09). */
  routeIds: string[];
}

export interface PlannedLapView {
  listId: string;
  routeId: string;
  count: number;
  costMicro: number;
}

export interface EstimateView {
  contacts: number;
  sids: number;
  texts: number;
  links: number;
  testSize: number;
  sendAll: boolean;
  smsCount: number;
  costMicro: number;
  laps: PlannedLapView[];
}

export interface AuditView {
  id: string;
  action: string;
  actorUserId: string | null;
  details: Record<string, unknown> | null;
  createdAt: string;
}

/** One row of Logs › Messages. */
export interface CampaignMessageView {
  id: string;
  at: string;
  lapId: string;
  routeName: string;
  senderId: string;
  recipient: string;
  text: string;
  status: string;
  errorCode: string | null;
  clicked: boolean;
}

export interface CampaignMessagesView {
  rows: CampaignMessageView[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CampaignSummaryView {
  id: string;
  name: string;
  country: string;
  timezone: string;
  status: CampaignStatus;
  createdAt: string;
  lapsCount: number;
  sent: number;
  clicks: number;
  ctr: number;
  costMicro: number;
  leads: number;
  sales: number;
  firstLapAt: string | null;
  lastLapAt: string | null;
}

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Campaign results (D3-05)
// ---------------------------------------------------------------------------

export interface ResultRatesView {
  ctr: number;
  deliveryRate: number;
  failureRate: number;
  cpcMicro: number | null;
  cplMicro: number | null;
  cpsMicro: number | null;
}

export interface ResultTotalsView extends ResultRatesView {
  sent: number;
  delivered: number;
  failed: number;
  clicks: number;
  leads: number;
  sales: number;
  costMicro: number;
  revenueMicro: number;
}

export interface LapResultView extends LapView, ResultRatesView {
  on: boolean;
}

export interface NetworkRowView {
  routeId: string;
  name: string;
  provider: string;
  sent: number;
  delivered: number;
  failed: number;
  clicks: number;
  ctr: number;
  deliveryRate: number;
  costMicro: number;
}

export interface ClicksPerHourView {
  hour: number;
  at: string;
  clicks: number;
}

export interface ClicksPerLinkView {
  linkId: string | null;
  name: string;
  url: string | null;
  sent: number;
  clicks: number;
  ctr: number;
}

export interface CampaignResultsView {
  campaignId: string;
  firstSentAt: string | null;
  lastSentAt: string | null;
  totals: ResultTotalsView;
  laps: LapResultView[];
  networks: { source: "route"; rows: NetworkRowView[] };
  clicksPerHour: ClicksPerHourView[];
  clicksPerLink: ClicksPerLinkView[];
}

export type PerformancePeriodView = "daily" | "weekly" | "monthly";

/** A platform route's anonymous ranks for the country (never another tenant's numbers). */
export interface PlatformRankView {
  routeId: string;
  name: string;
  priceMicro: number | null;
  ctrRank: number | null;
  cpcRank: number | null;
  overallRank: number | null;
}

/** The organisation's own numbers on a route for the country. */
export interface AccountStatView {
  routeId: string;
  name: string;
  priceMicro: number | null;
  costMicro: number;
  sent: number;
  clicks: number;
  ctr: number;
  cpcMicro: number | null;
}

export interface RoutePerformanceView {
  country: string;
  platform: Record<PerformancePeriodView, PlatformRankView[]>;
  account: Record<PerformancePeriodView, AccountStatView[]>;
}
