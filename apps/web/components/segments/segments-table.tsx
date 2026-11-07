"use client";

import {
  Button,
  ConfirmDialog,
  CountPill,
  EmptyState,
  IconButton,
  Input,
  PageHeader,
  Skeleton,
  UnderlineTabs,
  useToast,
} from "@sendex/ui";
import { Ban, Copy, Layers, List, Pencil, Plus, RefreshCw, Trash2, Upload } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState, useTransition } from "react";
import {
  deleteSegmentAction,
  duplicateSegmentAction,
  refreshSegmentStatsAction,
} from "../../app/(dashboard)/segments/actions";
import { formatNumber } from "../../lib/format";
import type { SegmentView } from "./types";

export type SegmentsTabView = "all" | "templates" | "excludes";

const TH =
  "whitespace-nowrap px-3 py-2.5 text-left font-mono text-[11px] font-semibold uppercase tracking-[0.07em] text-muted";
const TD = "px-3 py-3 text-sm align-top";

const dateOnly = new Intl.DateTimeFormat("en-US", { timeZone: "UTC" });

/**
 * The Segments list of the spec: Refresh Stats, Upload Contacts and + New Segment; the All,
 * Templates and Global Excludes tabs with counts; search; NAME (with the rule summary), SIZE,
 * GOOD, FLAGS, CREATED and the edit, duplicate and delete actions. Size and Good show grey
 * skeletons while Refresh Stats runs.
 */
export function SegmentsTable({
  rows,
  counts,
  tab,
  search,
  canEdit,
  canDelete,
}: {
  rows: SegmentView[];
  counts: { all: number; templates: number; excludes: number };
  tab: SegmentsTabView;
  search: string;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [query, setQuery] = useState(search);
  const [refreshing, startRefresh] = useTransition();
  const [pending, start] = useTransition();
  const [deleting, setDeleting] = useState<SegmentView | null>(null);

  function href(next: { tab?: SegmentsTabView; search?: string }): string {
    const params = new URLSearchParams();
    const t = next.tab ?? tab;
    const s = next.search ?? search;
    if (t !== "all") params.set("tab", t);
    if (s) params.set("search", s);
    const qs = params.toString();
    return `/segments${qs ? `?${qs}` : ""}`;
  }

  function onSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    router.push(href({ search: query.trim() }));
  }

  function refresh() {
    startRefresh(async () => {
      const result = await refreshSegmentStatsAction();
      if (!result.ok) {
        toast({ title: result.error, variant: "error" });
        return;
      }
      toast({
        title: `Stats refreshed for ${result.data.refreshed} segment${result.data.refreshed === 1 ? "" : "s"}`,
      });
      router.refresh();
    });
  }

  function duplicate(row: SegmentView) {
    start(async () => {
      const result = await duplicateSegmentAction(row.id);
      if (!result.ok) {
        toast({ title: result.error, variant: "error" });
        return;
      }
      toast({ title: "Segment duplicated", variant: "success" });
      router.push(`/segments/${result.data.id}`);
    });
  }

  return (
    <section className="space-y-4">
      <PageHeader
        breadcrumb={[{ label: "Contacts" }, { label: "Segments" }]}
        title="Segments"
        actions={
          <>
            <Button
              variant="outline"
              onClick={refresh}
              disabled={refreshing}
              data-testid="refresh-stats"
            >
              <RefreshCw
                className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
                aria-hidden="true"
              />{" "}
              Refresh Stats
            </Button>
            <Button variant="outline" asChild>
              <Link href="/lists/upload">
                <Upload className="h-4 w-4" aria-hidden="true" /> Upload Contacts
              </Link>
            </Button>
            {canEdit ? (
              <Button asChild>
                <Link href="/segments/new" data-testid="new-segment">
                  <Plus className="h-4 w-4" aria-hidden="true" /> New Segment
                </Link>
              </Button>
            ) : null}
          </>
        }
      />
      <UnderlineTabs
        label="Segment sections"
        value={tab}
        onChange={(next) => router.push(href({ tab: next }))}
        tabs={[
          { value: "all", label: "All", icon: <List />, count: counts.all },
          { value: "templates", label: "Templates", icon: <Layers />, count: counts.templates },
          { value: "excludes", label: "Global Excludes", icon: <Ban />, count: counts.excludes },
        ]}
      />
      <form onSubmit={onSearch} className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          placeholder="Search segments…"
          aria-label="Search segments"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-64"
        />
        <Button type="submit" variant="outline">
          Search
        </Button>
        <CountPill count={rows.length} noun="segment" className="ml-auto" testId="segments-count" />
      </form>

      {rows.length === 0 ? (
        <EmptyState
          icon={<Layers />}
          title="No segments yet"
          hint="Create your first segment to start targeting audiences"
          action={
            canEdit ? (
              <Button asChild>
                <Link href="/segments/new">
                  <Plus className="h-4 w-4" aria-hidden="true" /> New Segment
                </Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-rule bg-surface">
          <table className="w-full text-sm" data-testid="segments-table">
            <thead className="bg-page">
              <tr>
                <th className={TH}>Name</th>
                <th className={`${TH} text-right`}>Size</th>
                <th className={`${TH} text-right`}>Good</th>
                <th className={TH}>Flags</th>
                <th className={TH}>Created</th>
                <th className={`${TH} text-right`}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-rule" data-testid="segment-row">
                  <td className={`${TD} max-w-[28rem]`}>
                    <Link
                      href={`/segments/${row.id}`}
                      className="font-semibold text-ink hover:underline"
                    >
                      {row.name}
                    </Link>
                    <p className="truncate text-xs text-muted" title={row.summary}>
                      {row.summary}
                    </p>
                  </td>
                  <td className={`${TD} text-right font-mono tabular-nums`}>
                    {refreshing || row.size === null ? (
                      <Skeleton className="ml-auto h-4 w-12" />
                    ) : (
                      formatNumber(row.size)
                    )}
                  </td>
                  <td className={`${TD} text-right font-mono tabular-nums text-good`}>
                    {refreshing || row.good === null ? (
                      <Skeleton className="ml-auto h-4 w-12" />
                    ) : (
                      formatNumber(row.good)
                    )}
                  </td>
                  <td className={TD}>
                    <span className="inline-flex gap-1">
                      {row.isTemplate ? (
                        <span className="rounded-full border border-rule px-2 py-0.5 text-xs text-muted">
                          Template
                        </span>
                      ) : null}
                      {row.globalExclude ? (
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-800">
                          Global exclude
                        </span>
                      ) : null}
                      {!row.isTemplate && !row.globalExclude ? (
                        <span className="text-muted">--</span>
                      ) : null}
                    </span>
                  </td>
                  <td className={`${TD} whitespace-nowrap text-muted`}>
                    {dateOnly.format(new Date(row.createdAt))}
                  </td>
                  <td className={`${TD} text-right`}>
                    <span className="inline-flex items-center gap-1">
                      <IconButton
                        label={`Edit ${row.name}`}
                        tooltip="Edit segment"
                        icon={<Pencil />}
                        onClick={() => router.push(`/segments/${row.id}`)}
                      />
                      {canEdit ? (
                        <IconButton
                          label={`Duplicate ${row.name}`}
                          tooltip="Duplicate segment"
                          icon={<Copy />}
                          disabled={pending}
                          onClick={() => duplicate(row)}
                        />
                      ) : null}
                      {canDelete ? (
                        <IconButton
                          label={`Delete ${row.name}`}
                          tooltip="Delete segment"
                          icon={<Trash2 />}
                          tone="danger"
                          onClick={() => setDeleting(row)}
                        />
                      ) : null}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => {
          if (!o) setDeleting(null);
        }}
        title="Delete segment"
        description={`Delete "${deleting?.name ?? ""}"? Campaigns using it lose this audience. This action cannot be undone.`}
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (!deleting) return;
          const result = await deleteSegmentAction(deleting.id);
          if (!result.ok) throw new Error(result.error);
          toast({ title: "Segment deleted", variant: "success" });
          router.refresh();
        }}
      />
    </section>
  );
}
