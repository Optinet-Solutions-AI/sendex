import { formatEur, type LedgerKind } from "@sendex/core";
import type { LedgerEntryRow } from "@sendex/db";
import { Badge, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@sendex/ui";
import { formatDateTime } from "../../../lib/format";

const KIND_VARIANT: Record<LedgerKind, "success" | "destructive" | "warning" | "secondary"> = {
  deposit: "success",
  debit: "destructive",
  refund: "warning",
  adjustment: "secondary",
  fee: "destructive",
};

/** Server-rendered table of ledger entries: kind, amount, reference, note and date. */
export function LedgerTable({
  rows,
  emptyMessage,
  showKind = true,
}: {
  rows: LedgerEntryRow[];
  emptyMessage: string;
  showKind?: boolean;
}) {
  const columns = showKind ? 5 : 4;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Date</TableHead>
          {showKind ? <TableHead>Kind</TableHead> : null}
          <TableHead className="text-right">Amount</TableHead>
          <TableHead>Reference</TableHead>
          <TableHead>Note</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 ? (
          <TableRow>
            <TableCell colSpan={columns} className="h-24 text-center text-neutral-500">
              {emptyMessage}
            </TableCell>
          </TableRow>
        ) : (
          rows.map((row) => (
            <TableRow key={row.id} data-testid={`ledger-row-${row.id}`}>
              <TableCell className="whitespace-nowrap">{formatDateTime(row.createdAt)}</TableCell>
              {showKind ? (
                <TableCell>
                  <Badge variant={KIND_VARIANT[row.kind]} className="capitalize">
                    {row.kind}
                  </Badge>
                </TableCell>
              ) : null}
              <TableCell
                className={`text-right tabular-nums ${row.amountMicro < 0n ? "text-red-700" : "text-emerald-700"}`}
              >
                {formatEur(row.amountMicro)}
              </TableCell>
              <TableCell className="max-w-xs truncate">
                {row.referenceType ? (
                  <span className="text-neutral-500">{row.referenceType} </span>
                ) : null}
                <span className="font-mono text-xs" title={row.referenceId ?? undefined}>
                  {row.referenceId ?? "—"}
                </span>
              </TableCell>
              <TableCell className="max-w-sm truncate text-neutral-600" title={row.note ?? ""}>
                {row.note ?? ""}
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}
