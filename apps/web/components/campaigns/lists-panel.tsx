"use client";

import { Button, ConfirmDialog, IconButton, useToast } from "@sendex/ui";
import { ExternalLink, RefreshCw, Upload } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import {
  setCampaignListsAction,
  setCampaignSegmentsAction,
} from "../../app/(dashboard)/campaigns/actions";
import { flushListAction } from "../../app/(dashboard)/lists/actions";
import type { CampaignView, ListOption, SegmentOption } from "./types";
import { ErrorText } from "./ui";

const n = (v: number) => v.toLocaleString("en-GB");

/**
 * The Lists context tab of the spec: a Segments section (arrives with the segments phase)
 * and the Lists section with Upload List, one row per list of the campaign country with a
 * checkbox to include it, a progress bar, "Sent 600 / 1,896", Unsub, Bad and a flush button
 * whose tooltip reads 'Flush "…" — reset sending progress'.
 */
export function ListsPanel({
  campaign,
  lists,
  segmentOptions,
  canFlush,
  onChanged,
}: {
  campaign: CampaignView;
  lists: ListOption[];
  segmentOptions: SegmentOption[];
  canFlush: boolean;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [flushing, setFlushing] = useState<ListOption | null>(null);
  // Optimistic: the checkbox flips at once and is re-synced when the server data comes back.
  const fromServer = campaign.lists.map((l) => l.id).join(",");
  const [selected, setSelected] = useState<string[]>(() => campaign.lists.map((l) => l.id));
  useEffect(() => {
    setSelected(fromServer ? fromServer.split(",") : []);
  }, [fromServer]);

  function toggle(listId: string, checked: boolean) {
    const next = checked
      ? [...new Set([...selected, listId])]
      : selected.filter((id) => id !== listId);
    setSelected(next);
    setError(null);
    start(async () => {
      const result = await setCampaignListsAction({ campaignId: campaign.id, listIds: next });
      if (!result.ok) setError(result.error);
      else onChanged();
    });
  }

  function toggleSegment(segmentId: string, checked: boolean) {
    const current = campaign.segments.map((s) => s.id);
    const next = checked
      ? [...new Set([...current, segmentId])]
      : current.filter((id) => id !== segmentId);
    setError(null);
    start(async () => {
      const result = await setCampaignSegmentsAction({ campaignId: campaign.id, segmentIds: next });
      if (!result.ok) setError(result.error);
      else onChanged();
    });
  }

  async function flush(list: ListOption) {
    const result = await flushListAction(list.id);
    if (!result.ok) throw new Error(result.error);
    toast({
      title: `Flushed ${list.name}`,
      description: `${n(result.data.members)} numbers reset.`,
      variant: "success",
    });
    onChanged();
  }

  return (
    <div className="space-y-5" data-testid="lists-panel">
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h4 className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted">Segments</h4>
          <Button size="sm" variant="outline" asChild>
            <Link href="/segments/new">+ Create Segment</Link>
          </Button>
        </div>
        {segmentOptions.length === 0 ? (
          <p className="rounded-md border border-dashed border-rule px-3 py-3 text-xs text-muted">
            Saved audiences over your contacts and their history. Create one under Contacts ›
            Segments.
          </p>
        ) : (
          <ul className="divide-y divide-rule rounded-md border border-rule bg-surface">
            {segmentOptions.map((seg) => {
              const attached = campaign.segments.find((s) => s.id === seg.id);
              return (
                <li key={seg.id} className="flex items-start gap-3 px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={attached !== undefined}
                    aria-label={seg.name}
                    data-testid={`segment-${seg.id}`}
                    disabled={pending}
                    onChange={(e) => toggleSegment(seg.id, e.target.checked)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-ink">{seg.name}</span>
                    <span className="block truncate text-xs text-muted" title={seg.summary}>
                      {seg.summary}
                    </span>
                  </span>
                  <span className="whitespace-nowrap font-mono text-xs text-muted">
                    {attached
                      ? `${n(attached.available)} left`
                      : seg.good !== null
                        ? `${n(seg.good)} good`
                        : "–"}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h4 className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted">Lists</h4>
          <Button size="sm" variant="outline" asChild>
            <Link href="/lists/upload">
              <Upload className="h-4 w-4" aria-hidden="true" /> Upload List
            </Link>
          </Button>
        </div>
        {lists.length === 0 ? (
          <p className="text-sm text-muted">
            No lists for {campaign.country} yet. Upload one under Contacts › Lists.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left font-mono text-[11px] uppercase tracking-[0.07em] text-muted">
              <tr>
                <th className="py-1.5 pr-2 font-semibold">Name</th>
                <th className="py-1.5 pr-2 text-right font-semibold">Sent</th>
                <th className="py-1.5 pr-2 text-right font-semibold">Unsub</th>
                <th className="py-1.5 pr-2 text-right font-semibold">Bad</th>
                <th className="py-1.5 font-semibold" />
              </tr>
            </thead>
            <tbody className="divide-y divide-rule">
              {lists.map((list) => {
                const pct =
                  list.numbersCount > 0 ? Math.round((list.sent / list.numbersCount) * 100) : 0;
                return (
                  <tr key={list.id} className="align-top">
                    <td className="py-2 pr-2">
                      <label className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          className="mt-1"
                          aria-label={list.name}
                          checked={selected.includes(list.id)}
                          disabled={pending}
                          onChange={(e) => toggle(list.id, e.target.checked)}
                          data-testid={`list-${list.id}`}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1 text-ink">
                            {list.name}
                            <Link
                              href={`/lists/${list.id}`}
                              target="_blank"
                              className="text-muted hover:text-ink"
                              aria-label={`Open ${list.name} in a new tab`}
                            >
                              <ExternalLink className="h-3 w-3" aria-hidden="true" />
                            </Link>
                          </span>
                          <span className="mt-1 block h-1.5 w-40 overflow-hidden rounded bg-neutral-200">
                            <span className="block h-full bg-navy" style={{ width: `${pct}%` }} />
                          </span>
                        </span>
                      </label>
                    </td>
                    <td className="whitespace-nowrap py-2 pr-2 text-right font-mono text-xs text-muted">
                      {n(list.sent)} / {n(list.numbersCount)}
                    </td>
                    <td className="py-2 pr-2 text-right font-mono text-xs text-muted">–</td>
                    <td className="py-2 pr-2 text-right font-mono text-xs text-muted">
                      {n(list.bad)}
                    </td>
                    <td className="py-1 text-right">
                      {canFlush ? (
                        <IconButton
                          label={`Flush ${list.name}`}
                          tooltip={`Flush "${list.name}" — reset sending progress`}
                          icon={<RefreshCw />}
                          tone="danger"
                          disabled={pending}
                          onClick={() => setFlushing(list)}
                        />
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <ErrorText error={error} />
      </section>

      <ConfirmDialog
        open={flushing !== null}
        onOpenChange={(open) => {
          if (!open) setFlushing(null);
        }}
        title="Flush list"
        description={
          flushing
            ? `Reset the sending progress of "${flushing.name}"? Its ${n(flushing.sent)} sent numbers become available again for every campaign.`
            : null
        }
        confirmLabel="Flush list"
        destructive
        onConfirm={async () => {
          if (flushing) await flush(flushing);
        }}
      />
    </div>
  );
}
