"use client";

import {
  countryName,
  flagEmoji,
  resultRates,
  TOP_UP_AMOUNTS_EUR,
  topUpPlan,
  topUpTooltip,
} from "@sendex/core";
import {
  Button,
  ConfirmDialog,
  CountPill,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  IconButton,
  Toggle,
  Tooltip,
  useToast,
} from "@sendex/ui";
import {
  CalendarClock,
  ExternalLink,
  FastForward,
  Info,
  MessageSquarePlus,
  MoreVertical,
  Plus,
  RotateCcw,
  SlidersHorizontal,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState, useTransition } from "react";
import {
  flushLapAction,
  rescheduleLapAction,
  sendCampaignAction,
  setLapCommentAction,
  toggleAllLapsAction,
  toggleLapAction,
  topUpLapsAction,
} from "../../app/(dashboard)/campaigns/actions";
import {
  formatDateTime,
  formatMicro,
  formatPer,
  formatPercent,
  formatPeriod,
  formatPricePerSms,
  shortId,
} from "./format";
import { isoToLocalInput, localInputToIso } from "./schedule";
import type { CampaignView, LapView } from "./types";
import { ErrorText, inputClass } from "./ui";

/** Columns the table can be sorted by; `rank` is the default (unranked laps last). */
export type LapSortKey =
  | "rank"
  | "sent"
  | "delivered"
  | "failed"
  | "delivery"
  | "previews"
  | "clicks"
  | "ctr"
  | "cost"
  | "cpc"
  | "leads"
  | "cpl"
  | "sales"
  | "cps";

interface LapRow extends LapView {
  on: boolean;
  ctr: number;
  deliveryRate: number;
  cpcMicro: number | null;
  cplMicro: number | null;
  cpsMicro: number | null;
}

function toRow(lap: LapView): LapRow {
  const rates = resultRates({
    sent: lap.sent,
    delivered: lap.delivered,
    failed: lap.failed,
    clicks: lap.clicks,
    leads: lap.leads,
    sales: lap.sales,
    costMicro: BigInt(Math.round(lap.costMicro)),
  });
  const micro = (v: bigint | null) => (v === null ? null : Number(v));
  return {
    ...lap,
    on: lap.status !== "cancelled",
    ctr: rates.ctr,
    deliveryRate: rates.deliveryRate,
    cpcMicro: micro(rates.cpcMicro),
    cplMicro: micro(rates.cplMicro),
    cpsMicro: micro(rates.cpsMicro),
  };
}

/** Null (no rank, no cost per X yet) sorts after every number whichever the direction. */
function sortValue(row: LapRow, key: LapSortKey): number | null {
  switch (key) {
    case "rank":
      return row.rank;
    case "sent":
      return row.sent;
    case "delivered":
      return row.delivered;
    case "failed":
      return row.failed;
    case "delivery":
      return row.deliveryRate;
    case "previews":
      return row.previews;
    case "clicks":
      return row.clicks;
    case "ctr":
      return row.ctr;
    case "cost":
      return row.costMicro;
    case "cpc":
      return row.cpcMicro;
    case "leads":
      return row.leads;
    case "cpl":
      return row.cplMicro;
    case "sales":
      return row.sales;
    case "cps":
      return row.cpsMicro;
  }
}

/** Sort laps by a column; nulls last; ties keep the server order (by creation). */
export function sortLaps(rows: readonly LapRow[], key: LapSortKey, dir: "asc" | "desc"): LapRow[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const av = sortValue(a.row, key);
      const bv = sortValue(b.row, key);
      if (av === null && bv === null) return a.index - b.index;
      if (av === null) return 1;
      if (bv === null) return -1;
      if (av !== bv) return dir === "asc" ? av - bv : bv - av;
      return a.index - b.index;
    })
    .map((x) => x.row);
}

const SORTABLE: ReadonlyArray<{ key: LapSortKey; label: string }> = [
  { key: "sent", label: "Sent" },
  { key: "delivered", label: "Delivered" },
  { key: "failed", label: "Failed" },
  { key: "delivery", label: "Delivery" },
  { key: "previews", label: "Previews" },
  { key: "clicks", label: "Clicks" },
  { key: "ctr", label: "CTR" },
  { key: "cost", label: "Cost" },
  { key: "cpc", label: "CPC" },
  { key: "leads", label: "Leads" },
  { key: "cpl", label: "CPL" },
  { key: "sales", label: "Sales" },
  { key: "cps", label: "CPS" },
  { key: "rank", label: "Rank" },
];

const TH =
  "whitespace-nowrap px-3 py-2 font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-muted";
const TD = "whitespace-nowrap px-3 py-2 text-sm";

function SortHeader({
  sortable,
  label,
  sortKey,
  dir,
  onSort,
}: {
  sortable: LapSortKey;
  label: string;
  sortKey: LapSortKey | null;
  dir: "asc" | "desc";
  onSort: (key: LapSortKey) => void;
}) {
  const active = sortable === sortKey;
  return (
    <th
      className={`${TH} text-right`}
      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={() => onSort(sortable)}
        data-testid={`sort-${sortable}`}
        className={`uppercase hover:text-ink ${active ? "font-semibold text-ink" : ""}`}
      >
        {label}
        {active ? (dir === "asc" ? " ▲" : " ▼") : ""}
      </button>
    </th>
  );
}

/** "daily_message_cap" -> "daily cap" on the lap row (D3-11); other reasons as stored. */
function refusalLabel(reason: string | null): string {
  if (reason === "daily_message_cap") return "daily cap";
  if (reason === "daily_spend_cap") return "daily spend cap";
  return reason ?? "cap";
}

const STATUS_LABEL: Record<LapView["status"], string> = {
  queued: "Queued",
  sending: "Sending",
  done: "Done",
  cancelled: "Off",
};

/** "09:09 (CET)": the time and the zone's short name (en-GB gives CET, not GMT+1). */
export function localClock(now: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZoneName: "short",
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${get("hour")}:${get("minute")} (${get("timeZoneName")})`;
}

/** The campaign's local time, ticking every half minute; empty until mounted. */
function useLocalClock(timezone: string): string {
  const [now, setNow] = useState<string>("");
  useEffect(() => {
    const tick = () => setNow(localClock(new Date(), timezone));
    tick();
    const id = window.setInterval(tick, 30_000);
    return () => window.clearInterval(id);
  }, [timezone]);
  return now;
}

type LapDialog =
  | { kind: "topup"; amountEur: number }
  | { kind: "custom" }
  | { kind: "finish" }
  | { kind: "comment"; lap: LapRow }
  | { kind: "reschedule"; lap: LapRow }
  | { kind: "flush"; lap: LapRow }
  | null;

/**
 * The laps of a running campaign, as the spec draws them: a header with the country and its
 * local time, the lap count, Custom and €5–€200 budget top-ups (the tooltip spells out the
 * maths), Finish List, Sort by rank and Show comments; then the table with every SMS Edge
 * column plus Delivered and Failed, an All switch, a per-lap switch, an ⓘ and a ⋮ menu with
 * Reschedule, Flush lap and Add comment. Off cancels a queued or sending lap; on re-queues a
 * cancelled one; a finished lap keeps its switch disabled.
 */
export function LapsTable({
  campaign,
  canToggle = false,
  canFlush = false,
}: {
  campaign: CampaignView;
  canToggle?: boolean;
  canFlush?: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const id = useId();
  const [byRank, setByRank] = useState(true);
  const [sortKey, setSortKey] = useState<LapSortKey | null>("rank");
  const [dir, setDir] = useState<"asc" | "desc">("asc");
  const [showComments, setShowComments] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [dialog, setDialog] = useState<LapDialog>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const clock = useLocalClock(campaign.timezone);
  const { laps, timezone } = campaign;

  if (laps.length === 0) return null;

  const rows = sortKey ? sortLaps(laps.map(toRow), sortKey, dir) : laps.map(toRow);
  const activeRows = rows.filter((r) => r.on && r.status !== "done");
  const allOn = rows.filter((r) => r.status !== "done").every((r) => r.on);
  const remaining =
    campaign.lists.reduce((sum, l) => sum + l.available, 0) +
    campaign.segments.reduce((sum, seg) => sum + seg.available, 0);
  const plan = (amountEur: number) =>
    topUpPlan({
      amountMicro: Math.round(amountEur * 1_000_000),
      laps: rows.map((r) => ({ id: r.id, active: r.on, priceMicro: r.priceMicro })),
      partsPerMessage: campaign.partsPerMessage,
    });

  function sortBy(key: LapSortKey) {
    setByRank(false);
    if (key === sortKey) {
      setDir(dir === "asc" ? "desc" : "asc");
      return;
    }
    setSortKey(key);
    setDir(key === "rank" ? "asc" : "desc");
  }

  function sortByRank(on: boolean) {
    setByRank(on);
    setSortKey(on ? "rank" : null);
    setDir("asc");
  }

  function refresh() {
    router.refresh();
  }

  function toggle(lap: LapRow, on: boolean) {
    setError(null);
    start(async () => {
      const result = await toggleLapAction({ campaignId: campaign.id, lapId: lap.id, on });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      refresh();
    });
  }

  function toggleAll(on: boolean) {
    setError(null);
    start(async () => {
      const result = await toggleAllLapsAction({ campaignId: campaign.id, on });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast({
        title: `${result.data} lap${result.data === 1 ? "" : "s"} switched ${on ? "on" : "off"}`,
      });
      refresh();
    });
  }

  async function topUp(amountEur: number) {
    const result = await topUpLapsAction({ campaignId: campaign.id, amountEur });
    if (!result.ok) throw new Error(result.error);
    toast({
      title: `Topped up ${result.data.laps} lap${result.data.laps === 1 ? "" : "s"}`,
      description: `${formatMicro(result.data.totalMicro)} of budget, about ${result.data.newSms.toLocaleString("en-GB")} more SMS.`,
      variant: "success",
    });
    refresh();
  }

  async function finishList() {
    const routeIds = [...new Set(activeRows.map((r) => r.routeId))];
    const result = await sendCampaignAction({ campaignId: campaign.id, routeIds, sendAll: true });
    if (!result.ok) throw new Error(result.error);
    toast({
      title: `${result.data.length} lap${result.data.length === 1 ? "" : "s"} queued`,
      description: "The rest of the list is on its way.",
      variant: "success",
    });
    refresh();
  }

  async function flush(lap: LapRow) {
    const result = await flushLapAction({ campaignId: campaign.id, lapId: lap.id });
    if (!result.ok) throw new Error(result.error);
    toast({
      title: `Flushed ${lap.listName}`,
      description: `${result.data.members.toLocaleString("en-GB")} numbers reset.`,
    });
    refresh();
  }

  const topUpButton = (amountEur: number) => {
    const p = plan(amountEur);
    return (
      <Tooltip key={amountEur} content={topUpTooltip(p, Math.round(amountEur * 1_000_000))}>
        <button
          type="button"
          data-testid={`top-up-${amountEur}`}
          disabled={!canToggle || pending || p.activeLaps === 0}
          onClick={() => setDialog({ kind: "topup", amountEur })}
          className="h-8 rounded-md border border-neutral-300 bg-surface px-2.5 font-mono text-xs text-ink hover:border-navy hover:bg-navy-soft disabled:cursor-not-allowed disabled:opacity-50"
        >
          €{amountEur}
        </button>
      </Tooltip>
    );
  };

  return (
    <section className="space-y-3" data-testid="laps-section">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-sm font-medium text-ink">
          <span aria-hidden="true">{flagEmoji(campaign.country)}</span>
          <span data-testid="laps-local-time">
            {campaign.country.toUpperCase()} {clock}
          </span>
          <span className="sr-only">{countryName(campaign.country)} local time</span>
        </span>
        <CountPill count={laps.length} noun="lap" testId="laps-count" />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!canToggle || pending}
            onClick={() => setDialog({ kind: "custom" })}
            data-testid="top-up-custom"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" /> Custom
          </Button>
          <fieldset
            className="inline-flex items-center gap-1 border-0 p-0"
            aria-label="Budget top-up"
          >
            <Plus className="h-3.5 w-3.5 text-muted" aria-hidden="true" />
            {TOP_UP_AMOUNTS_EUR.map(topUpButton)}
          </fieldset>
          <Tooltip content="Send everything left on the lists through the active routes">
            <Button
              size="sm"
              className="bg-good text-white hover:bg-emerald-700"
              disabled={!canToggle || pending || remaining === 0 || activeRows.length === 0}
              onClick={() => setDialog({ kind: "finish" })}
              data-testid="finish-list"
            >
              <FastForward className="h-3.5 w-3.5" aria-hidden="true" /> Finish List
            </Button>
          </Tooltip>
          <Toggle label="Sort by rank" checked={byRank} onCheckedChange={sortByRank} />
          <Toggle
            label="Show comments"
            checked={showComments}
            onCheckedChange={setShowComments}
            testId="show-comments"
          />
        </div>
      </div>
      <ErrorText error={error} />
      <div className="relative overflow-x-auto rounded-lg border border-rule bg-surface">
        <table className="w-full text-sm" data-testid="laps-table">
          <thead className="border-b border-rule bg-page text-left">
            <tr>
              <th className={TH}>Lap ID</th>
              <th className={TH}>Route</th>
              <th className={TH}>List</th>
              {SORTABLE.map((c) => (
                <SortHeader
                  key={c.key}
                  sortable={c.key}
                  label={c.label}
                  sortKey={sortKey}
                  dir={dir}
                  onSort={sortBy}
                />
              ))}
              <th className={TH}>Sending Period</th>
              <th className={TH}>
                <Toggle
                  label="All laps"
                  labelHidden
                  checked={allOn}
                  onCheckedChange={toggleAll}
                  disabled={!canToggle || pending}
                  testId="all-laps-toggle"
                />
              </th>
              <th className={TH}>
                <span className="sr-only">Details</span>
              </th>
              <th className={TH}>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((lap) => (
              <LapTr
                key={lap.id}
                lap={lap}
                timezone={timezone}
                canToggle={canToggle}
                canFlush={canFlush}
                pending={pending}
                showComments={showComments}
                menuOpen={menuFor === lap.id}
                onMenu={(open) => setMenuFor(open ? lap.id : null)}
                onToggle={(on) => toggle(lap, on)}
                onAction={(kind) => {
                  setMenuFor(null);
                  setDialog({ kind, lap });
                }}
              />
            ))}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={dialog?.kind === "topup"}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        title={dialog?.kind === "topup" ? `Top up €${dialog.amountEur}` : "Top up"}
        description={
          dialog?.kind === "topup"
            ? topUpTooltip(plan(dialog.amountEur), Math.round(dialog.amountEur * 1_000_000))
            : null
        }
        confirmLabel="Top up"
        onConfirm={async () => {
          if (dialog?.kind === "topup") await topUp(dialog.amountEur);
        }}
      />
      <CustomTopUpDialog
        open={dialog?.kind === "custom"}
        onClose={() => setDialog(null)}
        plan={plan}
        onConfirm={topUp}
      />
      <ConfirmDialog
        open={dialog?.kind === "finish"}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        title="Finish List"
        description={`Send the remaining ${remaining.toLocaleString("en-GB")} contacts through ${
          [...new Set(activeRows.map((r) => r.routeName))].join(", ") || "the active routes"
        }? One lap per list and route is queued and charged as it sends.`}
        confirmLabel="Finish List"
        onConfirm={finishList}
      />
      <CommentDialog
        key={dialog?.kind === "comment" ? dialog.lap.id : "comment"}
        open={dialog?.kind === "comment"}
        lap={dialog?.kind === "comment" ? dialog.lap : null}
        campaignId={campaign.id}
        onClose={() => setDialog(null)}
        onSaved={refresh}
      />
      <RescheduleDialog
        key={dialog?.kind === "reschedule" ? dialog.lap.id : "reschedule"}
        open={dialog?.kind === "reschedule"}
        lap={dialog?.kind === "reschedule" ? dialog.lap : null}
        campaignId={campaign.id}
        timezone={timezone}
        onClose={() => setDialog(null)}
        onSaved={refresh}
      />
      <ConfirmDialog
        open={dialog?.kind === "flush"}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        title="Flush lap"
        description={
          dialog?.kind === "flush"
            ? `Reset the sending progress of "${dialog.lap.listName}"? Its sent numbers become available again for every campaign.`
            : null
        }
        confirmLabel="Flush lap"
        destructive
        onConfirm={async () => {
          if (dialog?.kind === "flush") await flush(dialog.lap);
        }}
      />
      <span id={id} hidden />
    </section>
  );
}

function LapTr({
  lap,
  timezone,
  canToggle,
  canFlush,
  pending,
  showComments,
  menuOpen,
  onMenu,
  onToggle,
  onAction,
}: {
  lap: LapRow;
  timezone: string;
  canToggle: boolean;
  canFlush: boolean;
  pending: boolean;
  showComments: boolean;
  menuOpen: boolean;
  onMenu: (open: boolean) => void;
  onToggle: (on: boolean) => void;
  onAction: (kind: "comment" | "reschedule" | "flush") => void;
}) {
  // The table scrolls sideways, which would clip an absolutely placed menu: fix it to the viewport.
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);
  const info = (
    <div className="space-y-0.5">
      <div>Status: {STATUS_LABEL[lap.status]}</div>
      <div>Size: {lap.testSize.toLocaleString("en-GB")}</div>
      {lap.budgetMicro > 0 ? <div>Budget top-ups: {formatMicro(lap.budgetMicro)}</div> : null}
      {lap.scheduledAt ? <div>Starts: {formatDateTime(lap.scheduledAt, timezone)}</div> : null}
      {lap.refused > 0 ? (
        <div>
          Refused by {refusalLabel(lap.refusalReason)}: {lap.refused}
        </div>
      ) : null}
      <div className="font-mono text-[11px] opacity-80">{lap.id}</div>
    </div>
  );
  return (
    <>
      <tr
        className="border-t border-rule hover:bg-neutral-50"
        data-testid="lap-row"
        data-lap-id={lap.id}
        data-lap-status={lap.status}
        data-lap-rank={lap.rank ?? ""}
      >
        <td className={`${TD} font-mono text-xs text-muted`} title={lap.id}>
          {shortId(lap.id)}
        </td>
        <td className={`${TD} font-medium`}>
          Route {lap.routeName}
          {lap.autosender ? (
            <span
              className="ml-1 rounded-full bg-navy-soft px-1.5 py-0.5 font-mono text-[10px] uppercase text-navy"
              title="Queued by AutoSender"
            >
              Auto
            </span>
          ) : null}
          {lap.priceMicro !== null ? (
            <span className="ml-1 font-mono text-xs text-muted">
              ({formatPricePerSms(lap.priceMicro)})
            </span>
          ) : null}
        </td>
        <td className={TD}>
          <Tooltip content={lap.listName}>
            <a
              href={`/lists/${lap.listId}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex max-w-[14rem] items-center gap-1 text-navy hover:underline"
            >
              <span className="truncate">{lap.listName}</span>
              <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
            </a>
          </Tooltip>
          {lap.segmentName ? (
            <span
              className="ml-1 rounded-full bg-navy-soft px-1.5 py-0.5 text-[10px] text-navy"
              title={`Only contacts matching the segment ${lap.segmentName}`}
            >
              {lap.segmentName}
            </span>
          ) : null}
          {lap.refused > 0 ? (
            <span
              data-testid="lap-refused"
              title="A daily cap refused these messages; raise the cap under Settings, Billing and resume the campaign."
              className="block text-xs text-amber"
            >
              refused: {refusalLabel(lap.refusalReason)} ({lap.refused})
            </span>
          ) : null}
        </td>
        <td className={`${TD} text-right tabular-nums`} data-testid="lap-sent">
          {lap.sent}
        </td>
        <td className={`${TD} text-right tabular-nums`} data-testid="lap-delivered">
          {lap.delivered}
        </td>
        <td className={`${TD} text-right tabular-nums`} data-testid="lap-failed">
          {lap.failed}
        </td>
        <td className={`${TD} text-right tabular-nums`} data-testid="lap-delivery-rate">
          {formatPercent(lap.deliveryRate)}
        </td>
        <td className={`${TD} text-right tabular-nums`} data-testid="lap-previews">
          {lap.previews}
        </td>
        <td className={`${TD} text-right tabular-nums`} data-testid="lap-clicks">
          {lap.clicks}
        </td>
        <td className={`${TD} text-right tabular-nums`} data-testid="lap-ctr">
          {formatPercent(lap.ctr)}
        </td>
        <td className={`${TD} text-right tabular-nums`}>{formatMicro(lap.costMicro)}</td>
        <td className={`${TD} text-right tabular-nums`}>{formatPer(lap.cpcMicro)}</td>
        <td className={`${TD} text-right tabular-nums`}>{lap.leads}</td>
        <td className={`${TD} text-right tabular-nums`}>{formatPer(lap.cplMicro)}</td>
        <td className={`${TD} text-right tabular-nums`}>{lap.sales}</td>
        <td className={`${TD} text-right tabular-nums`}>{formatPer(lap.cpsMicro)}</td>
        <td className={`${TD} text-right tabular-nums`} data-testid="lap-rank">
          {lap.rank ?? "–"}
        </td>
        <td className={`${TD} text-xs text-muted`}>
          {formatPeriod(lap.startedAt, lap.finishedAt, timezone)}
        </td>
        <td className={TD}>
          <Toggle
            checked={lap.on}
            onCheckedChange={onToggle}
            label={`Lap ${lap.routeName} ${lap.on ? "on" : "off"}`}
            labelHidden
            testId="lap-toggle"
            disabled={!canToggle || pending || lap.status === "done"}
          />
        </td>
        <td className={TD}>
          <Tooltip content={info}>
            <span className="inline-flex h-8 w-8 items-center justify-center text-muted hover:text-ink">
              <Info className="h-4 w-4" aria-hidden="true" />
              <span className="sr-only">Lap details</span>
            </span>
          </Tooltip>
        </td>
        <td className={`${TD} relative`}>
          <IconButton
            label={`Lap ${shortId(lap.id)} actions`}
            tooltip="Lap actions"
            icon={<MoreVertical />}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              setMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
              onMenu(!menuOpen);
            }}
            data-testid="lap-menu"
          />
          {menuOpen && menuPos ? (
            <>
              <button
                type="button"
                aria-label="Close menu"
                className="fixed inset-0 z-10 cursor-default"
                onClick={() => onMenu(false)}
              />
              <div
                role="menu"
                style={{ top: menuPos.top, right: menuPos.right }}
                className="fixed z-20 w-44 rounded-md border border-rule bg-surface py-1 text-left text-sm shadow-md"
              >
                <button
                  type="button"
                  role="menuitem"
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-neutral-100 disabled:text-muted"
                  onClick={() => onAction("reschedule")}
                  disabled={!canToggle || lap.status !== "queued"}
                  title={
                    lap.status === "queued" ? undefined : "Only a queued lap can be rescheduled"
                  }
                >
                  <CalendarClock className="h-4 w-4" aria-hidden="true" /> Reschedule
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-neutral-100 disabled:text-muted"
                  onClick={() => onAction("flush")}
                  disabled={!canFlush}
                >
                  <RotateCcw className="h-4 w-4" aria-hidden="true" /> Flush lap
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-neutral-100"
                  onClick={() => onAction("comment")}
                >
                  <MessageSquarePlus className="h-4 w-4" aria-hidden="true" />
                  {lap.comment ? "Edit comment" : "Add comment"}
                </button>
              </div>
            </>
          ) : null}
        </td>
      </tr>
      {showComments ? (
        <tr className="bg-page" data-testid="lap-comment-row">
          <td colSpan={21} className="px-3 py-1.5 text-xs text-muted">
            <span className="font-mono uppercase tracking-[0.06em]">Comment</span>{" "}
            <span className="text-ink" data-testid="lap-comment">
              {lap.comment ?? "–"}
            </span>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function CustomTopUpDialog({
  open,
  onClose,
  plan,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  plan: (amountEur: number) => ReturnType<typeof topUpPlan>;
  onConfirm: (amountEur: number) => Promise<void>;
}) {
  const id = useId();
  const [amount, setAmount] = useState("25");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const eur = Number(amount);
  const valid = Number.isFinite(eur) && eur > 0;
  const preview = valid ? topUpTooltip(plan(eur), Math.round(eur * 1_000_000)) : null;

  async function submit() {
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm(eur);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent>
        <DialogTitle className="text-lg font-semibold">Custom top-up</DialogTitle>
        <DialogDescription className="mt-1 text-sm text-muted">
          Add a budget of your choice to every active lap.
        </DialogDescription>
        <form
          className="mt-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label htmlFor={`${id}-amount`} className="block text-sm font-medium text-ink">
            Amount (€)
          </label>
          <input
            id={`${id}-amount`}
            type="number"
            min={1}
            step="1"
            className={`${inputClass} w-40`}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            data-testid="custom-top-up-amount"
          />
          {preview ? <p className="text-xs text-muted">{preview}</p> : null}
          <ErrorText error={error} />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !valid} data-testid="custom-top-up-confirm">
              {busy ? "Working…" : "Top up"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CommentDialog({
  open,
  lap,
  campaignId,
  onClose,
  onSaved,
}: {
  open: boolean;
  lap: LapRow | null;
  campaignId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const id = useId();
  const [comment, setComment] = useState(lap?.comment ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit() {
    if (!lap) return;
    setError(null);
    start(async () => {
      const result = await setLapCommentAction({ campaignId, lapId: lap.id, comment });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onSaved();
      onClose();
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent>
        <DialogTitle className="text-lg font-semibold">
          {lap?.comment ? "Edit comment" : "Add comment"}
        </DialogTitle>
        <DialogDescription className="mt-1 text-sm text-muted">
          A note on this lap, shown under it with "Show comments".
        </DialogDescription>
        <form
          className="mt-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <label htmlFor={`${id}-comment`} className="sr-only">
            Comment
          </label>
          <textarea
            id={`${id}-comment`}
            className={`${inputClass} min-h-24`}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            maxLength={500}
            data-testid="lap-comment-input"
          />
          <ErrorText error={error} />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending} data-testid="lap-comment-save">
              {pending ? "Saving…" : "Save comment"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RescheduleDialog({
  open,
  lap,
  campaignId,
  timezone,
  onClose,
  onSaved,
}: {
  open: boolean;
  lap: LapRow | null;
  campaignId: string;
  timezone: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const id = useId();
  const [local, setLocal] = useState(isoToLocalInput(lap?.scheduledAt ?? null, timezone));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit() {
    if (!lap) return;
    const scheduledAt = localInputToIso(local, timezone);
    if (scheduledAt === null) {
      setError("Pick a start date and time");
      return;
    }
    setError(null);
    start(async () => {
      const result = await rescheduleLapAction({ campaignId, lapId: lap.id, scheduledAt });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onSaved();
      onClose();
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent>
        <DialogTitle className="text-lg font-semibold">Reschedule lap</DialogTitle>
        <DialogDescription className="mt-1 text-sm text-muted">
          The lap waits until this time ({timezone}) before it is picked up.
        </DialogDescription>
        <form
          className="mt-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <label htmlFor={`${id}-at`} className="block text-sm font-medium text-ink">
            Start time
          </label>
          <input
            id={`${id}-at`}
            type="datetime-local"
            className={`${inputClass} w-auto`}
            value={local}
            onChange={(e) => setLocal(e.target.value)}
            data-testid="lap-reschedule-input"
          />
          <ErrorText error={error} />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending} data-testid="lap-reschedule-save">
              {pending ? "Saving…" : "Reschedule"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
