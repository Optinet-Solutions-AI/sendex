"use client";

import { UploadSummarySchema } from "@sendex/core";
import {
  Badge,
  Button,
  ConfirmDialog,
  CountPill,
  IconButton,
  Input,
  PageHeader,
  PaginationBar,
  SimpleSelect,
  Tooltip,
  useToast,
} from "@sendex/ui";
import { ChevronDown, ChevronRight, Copy, FileText, Mail, Trash2, Upload } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, Fragment, useState } from "react";
import { formatDateTime, formatNumber } from "../../../../lib/format";
import { deleteListImportAction } from "../actions";

export interface ImportJobRow {
  id: string;
  fileName: string;
  source: string;
  status: string;
  rowsInFile: number;
  valid: number;
  added: number;
  addedGood: number;
  addedBad: number;
  rejected: number;
  skipped: number;
  duplicates: number;
  dedup: boolean;
  summary: Record<string, unknown>;
  listId: string;
  listName: string;
  createdAt: string;
}

const TH =
  "whitespace-nowrap px-3 py-2.5 text-left font-mono text-[11px] font-semibold uppercase tracking-[0.07em] text-muted";
const TD = "px-3 py-2.5 text-sm align-top";

function shortId(id: string): string {
  return id.split("-")[0] ?? id;
}

/** The spec's IMPORT RESULT box: one line per outcome, from the stored summary. */
function ImportResult({ job }: { job: ImportJobRow }) {
  const parsed = UploadSummarySchema.safeParse(job.summary);
  const s = parsed.success ? parsed.data : null;
  const lines: Array<[string, number]> = [
    ["Invalid Country Code", s?.dropped.no_country ?? 0],
    ["Invalid Number", (s?.dropped.invalid ?? 0) + (s?.dropped.unparseable ?? 0)],
    ["Premium or toll-free", (s?.dropped.premium ?? 0) + (s?.dropped.toll_free ?? 0)],
    ["Not Mobile", s?.addedBad.landline ?? job.addedBad],
    ["Not Logical", s?.addedBad.suspicious ?? 0],
    ["Found in another list", job.skipped],
    ["Duplicate in file", job.duplicates],
    ["Successfully Imported", job.addedGood],
  ];
  return (
    <div className="rounded-md border border-rule bg-surface p-3">
      <h4 className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted">
        Import result
      </h4>
      <dl className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 text-sm">
        {lines.map(([label, value]) => (
          <Fragment key={label}>
            <dt className="text-muted">{label}</dt>
            <dd className="text-right font-mono tabular-nums text-ink">{formatNumber(value)}</dd>
          </Fragment>
        ))}
      </dl>
    </div>
  );
}

function SampleBlock({
  tone,
  title,
  numbers,
  total,
}: {
  tone: "grey" | "red" | "amber";
  title: string;
  numbers: string[];
  total: number;
}) {
  const { toast } = useToast();
  if (total === 0) return null;
  const colour = tone === "red" ? "text-signal" : tone === "amber" ? "text-amber" : "text-muted";
  const more = total - numbers.length;
  return (
    <div className="rounded-md border border-rule bg-surface p-3 text-sm">
      <div className="flex items-start justify-between gap-2">
        <span className={`font-medium ${colour}`}>{title}</span>
        {numbers.length > 0 ? (
          <IconButton
            label={`Copy ${title}`}
            tooltip="Copy numbers"
            icon={<Copy />}
            onClick={() => {
              void navigator.clipboard
                .writeText(numbers.join("\n"))
                .then(() => toast({ title: "Numbers copied" }));
            }}
          />
        ) : null}
      </div>
      {numbers.length > 0 ? (
        <p className="mt-1 break-all font-mono text-xs text-muted">
          {numbers.join(", ")}
          {more > 0 ? ` … and ${formatNumber(more)} more` : ""}
        </p>
      ) : null}
    </div>
  );
}

/** The spec's DUPLICATES box plus the per-reason sample blocks. */
function Duplicates({ job }: { job: ImportJobRow }) {
  const parsed = UploadSummarySchema.safeParse(job.summary);
  const s = parsed.success ? parsed.data : null;
  return (
    <div className="space-y-2">
      <SampleBlock
        tone="grey"
        title={`Already in: ${formatNumber(job.skipped)} skipped`}
        numbers={s?.samples.skipped ?? []}
        total={job.skipped}
      />
      <SampleBlock
        tone="grey"
        title={`Duplicate in file: ${formatNumber(job.duplicates)}`}
        numbers={s?.samples.duplicates ?? []}
        total={job.duplicates}
      />
      <SampleBlock
        tone="red"
        title={`No valid phone number: ${formatNumber(job.rejected)} rejected`}
        numbers={s?.samples.rejected ?? []}
        total={job.rejected}
      />
      <SampleBlock
        tone="amber"
        title={`Not a mobile number (landline): ${formatNumber(s?.addedBad.landline ?? 0)} added as Bad`}
        numbers={s?.samples.landline ?? []}
        total={s?.addedBad.landline ?? 0}
      />
      <SampleBlock
        tone="amber"
        title={`Suspicious digit pattern (likely fake): ${formatNumber(s?.addedBad.suspicious ?? 0)} added as Bad`}
        numbers={s?.samples.suspicious ?? []}
        total={s?.addedBad.suspicious ?? 0}
      />
    </div>
  );
}

/**
 * The Files page of the spec: search, a status filter, "147 files", and a table with ›,
 * ID, File, Type, Status, Progress, List, Uploaded and actions; an expanded row shows the
 * IMPORT RESULT and DUPLICATES boxes.
 */
export function FilesTable({
  rows,
  total,
  page,
  pageSize,
  search,
  status,
  canDelete,
}: {
  rows: ImportJobRow[];
  total: number;
  page: number;
  pageSize: number;
  search: string;
  status: string;
  canDelete: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [query, setQuery] = useState(search);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [deleting, setDeleting] = useState<ImportJobRow | null>(null);

  function href(next: { search?: string; status?: string; page?: number }): string {
    const params = new URLSearchParams();
    const s = next.search ?? search;
    const st = next.status ?? status;
    if (s) params.set("search", s);
    if (st) params.set("status", st);
    if ((next.page ?? 1) > 1) params.set("page", String(next.page));
    const qs = params.toString();
    return `/lists/files${qs ? `?${qs}` : ""}`;
  }

  function onSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    router.push(href({ search: query.trim(), page: 1 }));
  }

  function toggle(id: string) {
    const next = new Set(open);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setOpen(next);
  }

  return (
    <section>
      <PageHeader
        breadcrumb={[{ label: "Contacts" }, { label: "Lists", href: "/lists" }, { label: "Files" }]}
        title="Files"
        actions={
          <Button asChild>
            <Link href="/lists/upload">
              <Upload className="h-4 w-4" aria-hidden="true" /> Upload File
            </Link>
          </Button>
        }
      />
      <form onSubmit={onSearch} className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          placeholder="Search files…"
          aria-label="Search files"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-64"
        />
        <SimpleSelect
          aria-label="Status"
          className="w-40"
          value={status || "all"}
          onValueChange={(value) =>
            router.push(href({ status: value === "all" ? "" : value, page: 1 }))
          }
          options={[
            { value: "all", label: "All statuses" },
            { value: "done", label: "Done" },
            { value: "failed", label: "Failed" },
          ]}
        />
        <Button type="submit" variant="outline">
          Search
        </Button>
        <CountPill count={total} noun="file" className="ml-auto" testId="files-count" />
      </form>

      <div className="mt-4 overflow-x-auto rounded-lg border border-rule bg-surface">
        <table className="w-full text-sm" data-testid="files-table">
          <thead className="bg-page">
            <tr>
              <th className={`${TH} w-8`}>
                <span className="sr-only">Expand</span>
              </th>
              <th className={TH}>ID</th>
              <th className={TH}>File</th>
              <th className={TH}>Type</th>
              <th className={TH}>Status</th>
              <th className={TH}>Progress</th>
              <th className={TH}>List</th>
              <th className={TH}>Uploaded</th>
              <th className={`${TH} text-right`}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-10 text-center text-sm text-muted">
                  No files yet. Upload a list to see its import here.
                </td>
              </tr>
            ) : (
              rows.map((job) => {
                const expanded = open.has(job.id);
                const pct = job.rowsInFile > 0 ? Math.round((job.valid / job.rowsInFile) * 100) : 0;
                return (
                  <Fragment key={job.id}>
                    <tr className="border-t border-rule" data-testid="file-row">
                      <td className={TD}>
                        <IconButton
                          label={expanded ? "Hide import summary" : "Show import summary"}
                          icon={expanded ? <ChevronDown /> : <ChevronRight />}
                          onClick={() => toggle(job.id)}
                          aria-expanded={expanded}
                        />
                      </td>
                      <td className={`${TD} font-mono text-xs text-muted`} title={job.id}>
                        {shortId(job.id)}
                      </td>
                      <td className={`${TD} font-medium text-ink`}>
                        <span className="inline-flex items-center gap-2">
                          <FileText className="h-4 w-4 text-muted" aria-hidden="true" />
                          <span className="break-all">{job.fileName}</span>
                        </span>
                      </td>
                      <td className={TD}>Contacts</td>
                      <td className={TD}>
                        <Badge variant={job.status === "done" ? "active" : "bad"}>
                          {job.status === "done" ? "Done" : "Failed"}
                        </Badge>
                      </td>
                      <td className={`${TD} min-w-[11rem]`}>
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-24 overflow-hidden rounded bg-neutral-200">
                            <div className="h-full bg-good" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="font-mono text-xs text-muted">
                            {formatNumber(job.valid)} / {formatNumber(job.rowsInFile)}
                          </span>
                        </div>
                      </td>
                      <td className={TD}>
                        <Link
                          href={`/lists/${job.listId}`}
                          className="text-navy underline-offset-2 hover:underline"
                        >
                          {job.listName} →
                        </Link>
                      </td>
                      <td className={`${TD} whitespace-nowrap text-muted`}>
                        {formatDateTime(job.createdAt)}
                      </td>
                      <td className={`${TD} text-right`}>
                        <span className="inline-flex items-center gap-1">
                          <Tooltip content="Files are imported as they are uploaded">
                            <span>
                              <IconButton
                                label="Import this file"
                                icon={<Upload />}
                                disabled
                                noTooltip
                              />
                            </span>
                          </Tooltip>
                          <Tooltip content="E-mail me the import summary (coming later)">
                            <span>
                              <IconButton
                                label="E-mail me the import summary"
                                icon={<Mail />}
                                disabled
                                noTooltip
                              />
                            </span>
                          </Tooltip>
                          {canDelete ? (
                            <IconButton
                              label={`Delete ${job.fileName}`}
                              tooltip="Delete"
                              icon={<Trash2 />}
                              tone="danger"
                              onClick={() => setDeleting(job)}
                            />
                          ) : null}
                        </span>
                      </td>
                    </tr>
                    {expanded ? (
                      <tr className="border-t border-rule bg-page" data-testid="file-summary">
                        <td colSpan={9} className="px-4 py-3">
                          <ImportSummaryPanel job={job} />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <PaginationBar
        className="mt-3"
        page={page}
        pageSize={pageSize}
        total={total}
        style="page-of-total"
        pageHref={(to) => href({ page: to })}
      />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => {
          if (!o) setDeleting(null);
        }}
        title="Delete file record"
        description={`Remove "${deleting?.fileName ?? ""}" from the Files page? The numbers it added stay in the list.`}
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (!deleting) return;
          const result = await deleteListImportAction(deleting.id);
          if (!result.ok) throw new Error(result.error);
          toast({ title: "File record deleted", variant: "success" });
          router.refresh();
        }}
      />
    </section>
  );
}

/** "4,346 rows → 4,342 added (4,047 good, 295 bad) · 1 rejected · 3 skipped" plus the two boxes. */
export function ImportSummaryPanel({ job }: { job: ImportJobRow }) {
  return (
    <div>
      <p className="mb-3 text-sm text-ink">
        {formatNumber(job.rowsInFile)} rows → {formatNumber(job.added)} added (
        {formatNumber(job.addedGood)} good, {formatNumber(job.addedBad)} bad) ·{" "}
        {formatNumber(job.rejected)} rejected · {formatNumber(job.skipped)} skipped
        {job.dedup ? (
          <Badge variant="amber" className="ml-2">
            Dedup: ON
          </Badge>
        ) : null}
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        <ImportResult job={job} />
        <Duplicates job={job} />
      </div>
    </div>
  );
}
