"use client";

import { Badge, EmptyState, PaginationBar, PillTabs } from "@sendex/ui";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { formatDateTime, shortId } from "./format";
import type { LogsSubTab } from "./tabs";
import type { AuditView, CampaignMessagesView, CampaignView } from "./types";

const SUB_TABS = [
  { value: "messages", label: "Messages" },
  { value: "actions", label: "Actions" },
  { value: "adtexts", label: "Ad Texts" },
  { value: "offers", label: "Offers" },
  { value: "sids", label: "SIDs" },
] as const satisfies readonly { value: LogsSubTab; label: string }[];

const ACTION_LABELS: Record<string, string> = {
  "campaign.create": "Campaign created",
  "campaign.send": "Send queued",
  "campaign.pause": "Paused",
  "campaign.resume": "Resumed",
  "campaign.stop": "Stopped",
  "campaign.reschedule": "Rescheduled",
  "campaign.cancel_schedule": "Schedule cancelled",
  "campaign.duplicate": "Duplicated",
  "campaign.delete": "Deleted",
  "lap.toggle": "Lap switched",
  "lap.finish": "Lap finished",
};

function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

function statusVariant(status: string): "active" | "bad" | "secondary" | "warning" {
  if (status === "delivered") return "active";
  if (status === "failed" || status === "expired" || status === "cancelled") return "bad";
  if (status === "sent") return "secondary";
  return "warning";
}

/**
 * The Logs tab of the spec: Messages, Actions (Date · Lap · User · Action), Ad Texts, Offers
 * and SIDs as pill sub-tabs, the active one in `?logs=`.
 */
export function LogsTab({
  campaign,
  active,
  audit,
  messages,
  panels,
}: {
  campaign: CampaignView;
  active: LogsSubTab;
  audit: AuditView[];
  messages: CampaignMessagesView;
  /** The read-only Ad Texts, Offers and SIDs views, rendered by the page. */
  panels: { adtexts: ReactNode; offers: ReactNode; sids: ReactNode };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const go = (next: LogsSubTab, page?: number) => {
    const q = new URLSearchParams(params.toString());
    q.set("tab", "logs");
    q.set("logs", next);
    if (page && page > 1) q.set("mpage", String(page));
    else q.delete("mpage");
    router.replace(`${pathname}?${q.toString()}`, { scroll: false });
  };
  return (
    <div className="space-y-4">
      <PillTabs label="Log sections" value={active} tabs={SUB_TABS} onChange={(t) => go(t)} />
      {active === "messages" ? (
        messages.total === 0 ? (
          <EmptyState title="No messages yet" hint="Messages appear here as laps send." />
        ) : (
          <div className="space-y-3">
            <div className="overflow-x-auto rounded-lg border border-rule bg-surface">
              <table className="w-full text-sm" data-testid="messages-table">
                <thead className="bg-page text-left font-mono text-[11px] font-semibold uppercase tracking-[0.07em] text-muted">
                  <tr>
                    <th className="px-3 py-2">Sent</th>
                    <th className="px-3 py-2">Lap</th>
                    <th className="px-3 py-2">Route</th>
                    <th className="px-3 py-2">SID</th>
                    <th className="px-3 py-2">Recipient</th>
                    <th className="px-3 py-2">Text</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Clicked</th>
                  </tr>
                </thead>
                <tbody>
                  {messages.rows.map((m) => (
                    <tr key={m.id} className="border-t border-rule align-top">
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-muted">
                        {formatDateTime(m.at, campaign.timezone)}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-muted" title={m.lapId}>
                        {shortId(m.lapId)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">{m.routeName}</td>
                      <td className="px-3 py-2 font-mono text-xs">{m.senderId}</td>
                      <td className="px-3 py-2 font-mono text-xs">{m.recipient}</td>
                      <td className="max-w-md px-3 py-2 text-xs text-muted">{m.text}</td>
                      <td className="px-3 py-2">
                        <Badge variant={statusVariant(m.status)} title={m.errorCode ?? undefined}>
                          {m.status}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-xs">{m.clicked ? "Yes" : "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <PaginationBar
              page={messages.page}
              pageSize={messages.pageSize}
              total={messages.total}
              style="page-of-total"
              onPageChange={(p) => go("messages", p)}
            />
          </div>
        )
      ) : null}
      {active === "actions" ? (
        audit.length === 0 ? (
          <EmptyState title="Nothing logged for this campaign yet." />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-rule bg-surface">
            <table className="w-full text-sm" data-testid="logs-table">
              <thead className="bg-page text-left font-mono text-[11px] font-semibold uppercase tracking-[0.07em] text-muted">
                <tr>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Lap</th>
                  <th className="px-3 py-2">User</th>
                  <th className="px-3 py-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {audit.map((e) => {
                  const lap =
                    e.details && typeof e.details.lapId === "string" ? e.details.lapId : null;
                  return (
                    <tr
                      key={e.id}
                      className="border-t border-rule align-top"
                      data-action={e.action}
                    >
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-muted">
                        {formatDateTime(e.createdAt, campaign.timezone)}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-muted">
                        {lap ? shortId(lap) : "–"}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-muted">
                        {e.actorUserId ? shortId(e.actorUserId) : "system"}
                      </td>
                      <td className="px-3 py-2">
                        <span className="font-medium text-ink">{actionLabel(e.action)}</span>
                        <span className="ml-2 font-mono text-[11px] text-muted">{e.action}</span>
                        {e.details ? (
                          <span className="ml-2 font-mono text-[11px] text-muted">
                            {JSON.stringify(e.details)}
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      ) : null}
      {active === "adtexts" ? panels.adtexts : null}
      {active === "offers" ? panels.offers : null}
      {active === "sids" ? panels.sids : null}
    </div>
  );
}
