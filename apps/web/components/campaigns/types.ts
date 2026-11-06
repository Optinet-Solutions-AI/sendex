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
}

export interface AdTextView {
  id: string;
  text: string;
  encoding: string;
  parts: number;
  active: boolean;
  position: number;
}

export interface CampaignLinkView {
  id: string;
  name: string;
  url: string;
  active: boolean;
}

export interface LinkOption {
  id: string;
  name: string;
  url: string;
}

export interface RouteView {
  id: string;
  name: string;
  provider: string;
  platform: boolean;
  priceMicro: number | null;
}

export interface LapView {
  id: string;
  routeId: string;
  routeName: string;
  listId: string;
  listName: string;
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
}

export interface CampaignView {
  id: string;
  name: string;
  country: string;
  timezone: string;
  status: CampaignStatus;
  contactReuse: ContactReuse;
  testSize: number;
  scheduledAt: string | null;
  createdAt: string;
  updatedAt: string;
  lists: ListOption[];
  sidGroup: SidGroupView | null;
  adTexts: AdTextView[];
  links: CampaignLinkView[];
  laps: LapView[];
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
