"use client";

import { countryName } from "@sendex/core";
import { Badge, Button, PaginationBar } from "@sendex/ui";
import Link from "next/link";
import { formatDateTime } from "../../lib/format";

export interface ContactRowView {
  id: string;
  /** Masked: the last four digits replaced by ****. */
  number: string;
  country: string;
  bad: boolean;
  badReason: string | null;
  sent: boolean;
  createdAt: string;
}

const TH =
  "whitespace-nowrap px-3 py-2.5 text-left font-mono text-[11px] font-semibold uppercase tracking-[0.07em] text-muted";
const TD = "px-3 py-2.5 text-sm";

function tabHref(
  listId: string,
  next: { search?: string; status?: string; page?: number },
): string {
  const params = new URLSearchParams();
  if (next.search) params.set("q", next.search);
  if (next.status) params.set("status", next.status);
  if ((next.page ?? 1) > 1) params.set("page", String(next.page));
  const qs = params.toString();
  return `/lists/${listId}${qs ? `?${qs}` : ""}`;
}

/**
 * The Contacts tab of the spec: "Search by number…", All Statuses, a table of masked numbers
 * with Country, Status (Good / Bad), Cached, Meta and Created, and "Showing 1 - 25 of 4,339
 * contacts" with ‹ 1 / 174 ›. Full numbers are never shown here.
 */
export function ContactsTab({
  listId,
  rows,
  total,
  page,
  pageSize,
  search,
  status,
}: {
  listId: string;
  rows: ContactRowView[];
  total: number;
  page: number;
  pageSize: number;
  search: string;
  status: string;
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="space-y-3">
      <form method="get" action={`/lists/${listId}`} className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          name="q"
          defaultValue={search}
          placeholder="Search by number…"
          aria-label="Search by number"
          className="h-9 w-64 rounded-md border border-neutral-300 bg-surface px-3 text-sm"
        />
        <select
          name="status"
          defaultValue={status}
          aria-label="Status"
          className="h-9 rounded-md border border-neutral-300 bg-surface px-3 text-sm"
        >
          <option value="">All Statuses</option>
          <option value="good">Good</option>
          <option value="bad">Bad</option>
          <option value="sent">Sent</option>
        </select>
        <Button type="submit" variant="outline">
          Apply
        </Button>
      </form>
      <div className="overflow-x-auto rounded-lg border border-rule bg-surface">
        <table className="w-full text-sm" data-testid="contacts-table">
          <thead className="bg-page">
            <tr>
              <th className={TH}>Number</th>
              <th className={TH}>Country</th>
              <th className={TH}>Status</th>
              <th className={TH}>Cached</th>
              <th className={TH}>Meta</th>
              <th className={TH}>Created</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-10 text-center text-sm text-muted">
                  No contacts match.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="border-t border-rule" data-testid="contact-row">
                  <td className={`${TD} font-mono text-ink`}>{row.number}</td>
                  <td className={TD}>
                    <span className="font-semibold">{row.country}</span>{" "}
                    <span className="text-muted">{countryName(row.country)}</span>
                  </td>
                  <td className={TD}>
                    {row.bad ? (
                      <Badge variant="bad" title={row.badReason ?? undefined}>
                        Bad
                      </Badge>
                    ) : (
                      <Badge variant="active">Good</Badge>
                    )}
                    {row.sent ? (
                      <Badge variant="secondary" className="ml-1">
                        Sent
                      </Badge>
                    ) : null}
                  </td>
                  <td className={TD}>
                    <span
                      className="inline-block h-2 w-2 rounded-full bg-neutral-300"
                      title="No lookup cached"
                    />
                  </td>
                  <td className={`${TD} text-muted`}>-</td>
                  <td className={`${TD} whitespace-nowrap font-mono text-xs text-muted`}>
                    {formatDateTime(row.createdAt)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
        <PaginationBar
          page={page}
          pageSize={pageSize}
          total={total}
          style="showing"
          noun="contacts"
          pageHref={(to) => tabHref(listId, { search, status, page: to })}
          renderLink={(href, children, disabled) =>
            disabled ? (
              <span className="inline-flex h-8 items-center rounded-md border border-neutral-300 px-3 opacity-50">
                {children}
              </span>
            ) : (
              <Link
                href={href}
                className="inline-flex h-8 items-center rounded-md border border-neutral-300 bg-surface px-3 hover:bg-neutral-100"
              >
                {children}
              </Link>
            )
          }
          className="w-full"
        />
        <span className="sr-only">
          {page} / {pageCount}
        </span>
      </div>
    </div>
  );
}
