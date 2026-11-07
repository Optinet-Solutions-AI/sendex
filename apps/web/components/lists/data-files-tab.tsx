"use client";

import { Badge, Button, Card } from "@sendex/ui";
import { CheckCircle2, ChevronDown, ChevronUp, FileText, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  type ImportJobRow,
  ImportSummaryPanel,
} from "../../app/(dashboard)/lists/files/files-table";
import { UploadForm } from "../../app/(dashboard)/lists/upload/upload-form";
import { formatDateTime, formatNumber } from "../../lib/format";

/** One Recent Uploads card of the spec, with "Summary ⌃" to expand the import result. */
function UploadCard({ job }: { job: ImportJobRow }) {
  const [open, setOpen] = useState(false);
  return (
    <Card className="p-4" data-testid="upload-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <FileText className="mt-0.5 h-5 w-5 shrink-0 text-muted" aria-hidden="true" />
          <div className="min-w-0">
            <p className="break-all font-medium text-ink">{job.fileName}</p>
            <p className="text-sm text-good">{formatNumber(job.added)} added to list</p>
            <p className="text-xs text-muted">
              {formatNumber(job.rowsInFile)} rows in file · {formatNumber(job.valid)} valid{" "}
              {job.dedup ? (
                <Badge variant="amber" className="ml-1">
                  Dedup: ON
                </Badge>
              ) : null}
            </p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 text-xs text-muted">
          <Badge variant={job.status === "done" ? "active" : "bad"}>
            <CheckCircle2 className="mr-1 inline h-3 w-3" aria-hidden="true" />
            {job.status === "done" ? "Complete" : "Failed"}
          </Badge>
          <span>{formatDateTime(job.createdAt)}</span>
          <button
            type="button"
            className="inline-flex items-center gap-1 text-ink hover:underline"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
          >
            Summary {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
        </div>
      </div>
      {open ? (
        <div className="mt-3 border-t border-rule pt-3">
          <ImportSummaryPanel job={job} />
        </div>
      ) : null}
    </Card>
  );
}

/**
 * The Data Files tab of the spec: a drop zone that adds numbers to this list (the upload
 * form with the target fixed), then Recent Uploads as cards with their summaries.
 */
export function DataFilesTab({
  list,
  jobs,
  canUpload,
}: {
  list: { id: string; name: string; country: string };
  jobs: ImportJobRow[];
  canUpload: boolean;
}) {
  const router = useRouter();
  return (
    <div className="space-y-6">
      {canUpload ? (
        <Card className="p-4">
          <UploadForm lists={[]} fixedList={list} />
        </Card>
      ) : null}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-ink">Recent Uploads</h3>
          <Button variant="outline" size="sm" onClick={() => router.refresh()}>
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Refresh
          </Button>
        </div>
        {jobs.length === 0 ? (
          <p className="text-sm text-muted">No uploads yet.</p>
        ) : (
          <div className="space-y-3">
            {jobs.map((job) => (
              <UploadCard key={job.id} job={job} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
