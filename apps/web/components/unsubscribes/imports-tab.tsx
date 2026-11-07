import { EmptyState } from "@sendex/ui";
import { FileText } from "lucide-react";
import { formatDateTime, formatNumber } from "../../lib/format";

export interface SuppressionImportView {
  id: string;
  fileName: string;
  count: number;
  rejected: number;
  createdAt: string;
}

const TH =
  "whitespace-nowrap px-3 py-2.5 text-left font-mono text-[11px] font-semibold uppercase tracking-[0.07em] text-muted";
const TD = "px-3 py-2.5 text-sm";

/** The Imported lists tab: one row per uploaded suppression file. */
export function ImportsTab({ rows }: { rows: SuppressionImportView[] }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<FileText />}
        title="No suppression files yet"
        hint="Upload unsubscribes (CSV, XLS or XLSX) and each file shows here with its count."
      />
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-rule bg-surface">
      <table className="w-full text-sm" data-testid="unsub-imports-table">
        <thead className="bg-page">
          <tr>
            <th className={TH}>File</th>
            <th className={`${TH} text-right`}>Numbers</th>
            <th className={`${TH} text-right`}>Rejected rows</th>
            <th className={TH}>Uploaded</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t border-rule" data-testid="unsub-import-row">
              <td className={`${TD} font-medium text-ink`}>
                <span className="inline-flex items-center gap-2">
                  <FileText className="h-4 w-4 text-muted" aria-hidden="true" />
                  {row.fileName}
                </span>
              </td>
              <td className={`${TD} text-right font-mono tabular-nums`}>
                {formatNumber(row.count)}
              </td>
              <td className={`${TD} text-right font-mono tabular-nums text-muted`}>
                {formatNumber(row.rejected)}
              </td>
              <td className={`${TD} whitespace-nowrap text-muted`}>
                {formatDateTime(row.createdAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
