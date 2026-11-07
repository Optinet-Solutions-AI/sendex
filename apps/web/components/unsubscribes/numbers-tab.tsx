"use client";

import { countryName } from "@sendex/core";
import { Badge, Button, CountPill, EmptyState, PaginationBar } from "@sendex/ui";
import { BellOff } from "lucide-react";
import Link from "next/link";
import { formatDateTime } from "../../lib/format";

export interface SuppressionRowView {
  id: string;
  e164: string;
  country: string | null;
  source: string;
  createdAt: string;
}

const TH =
  "whitespace-nowrap px-3 py-2.5 text-left font-mono text-[11px] font-semibold uppercase tracking-[0.07em] text-muted";
const TD = "px-3 py-2.5 text-sm";

const SOURCE_LABEL: Record<string, string> = {
  manual: "Added by hand",
  upload: "Uploaded file",
  api: "Unsubscribe API",
  sms: "STOP reply",
  provider: "Carrier",
};

function href(next: { search?: string; page?: number }): string {
  const params = new URLSearchParams();
  if (next.search) params.set("q", next.search);
  if ((next.page ?? 1) > 1) params.set("page", String(next.page));
  const qs = params.toString();
  return `/unsubscribes${qs ? `?${qs}` : ""}`;
}

/** The Numbers tab: "Search by number…", "n numbers", Number · Country · Source · Unsubscribed. */
export function NumbersTab({
  rows,
  total,
  page,
  pageSize,
  search,
}: {
  rows: SuppressionRowView[];
  total: number;
  page: number;
  pageSize: number;
  search: string;
}) {
  return (
    <div className="space-y-3">
      <form method="get" action="/unsubscribes" className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          name="q"
          defaultValue={search}
          placeholder="Search by number…"
          aria-label="Search by number"
          className="h-9 w-64 rounded-md border border-neutral-300 bg-surface px-3 text-sm"
        />
        <Button type="submit" variant="outline">
          Search
        </Button>
        <CountPill count={total} noun="number" className="ml-auto" testId="unsub-numbers-count" />
      </form>
      {rows.length === 0 ? (
        <EmptyState
          icon={<BellOff />}
          title={search ? "No number matches" : "Nobody has unsubscribed yet."}
          hint={
            search
              ? "Try fewer digits."
              : "Numbers added here, uploaded, or sent by the Unsubscribe API appear in this table."
          }
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-rule bg-surface">
            <table className="w-full text-sm" data-testid="unsub-table">
              <thead className="bg-page">
                <tr>
                  <th className={TH}>Number</th>
                  <th className={TH}>Country</th>
                  <th className={TH}>Source</th>
                  <th className={TH}>Unsubscribed</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-t border-rule" data-testid="unsub-row">
                    <td className={`${TD} font-mono text-ink`}>{row.e164}</td>
                    <td className={TD}>
                      {row.country ? (
                        <>
                          <span className="font-semibold">{row.country}</span>{" "}
                          <span className="text-muted">{countryName(row.country)}</span>
                        </>
                      ) : (
                        <span className="text-muted">--</span>
                      )}
                    </td>
                    <td className={TD}>
                      <Badge variant="secondary">{SOURCE_LABEL[row.source] ?? row.source}</Badge>
                    </td>
                    <td className={`${TD} whitespace-nowrap font-mono text-xs text-muted`}>
                      {formatDateTime(row.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <PaginationBar
            page={page}
            pageSize={pageSize}
            total={total}
            style="showing"
            noun="numbers"
            pageHref={(to) => href({ search, page: to })}
            renderLink={(to, children, disabled) =>
              disabled ? (
                <span className="inline-flex h-8 items-center rounded-md border border-neutral-300 px-3 opacity-50">
                  {children}
                </span>
              ) : (
                <Link
                  href={to}
                  className="inline-flex h-8 items-center rounded-md border border-neutral-300 bg-surface px-3 hover:bg-neutral-100"
                >
                  {children}
                </Link>
              )
            }
          />
        </>
      )}
    </div>
  );
}
