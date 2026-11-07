"use client";

import { countryName, flagEmoji, SEND_BUCKETS, type SeriesRow } from "@sendex/core";
import {
  Card,
  CardHeader,
  ChartFrame,
  ChartTable,
  GroupedHBars,
  Input,
  PaginationBar,
  StackedHBarsWithDot,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@sendex/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { type DashboardQuery, dashboardQueryString } from "../../lib/dashboard-params";
import { formatDateTime } from "../../lib/format";
import { countryLabel, int, pct } from "./format";

export interface ContactsTabProps {
  query: DashboardQuery;
  lists: {
    rows: Array<{ id: string; name: string; contacts: number }>;
    total: number;
    pageSize: number;
  };
  segments: Array<{ id: string; name: string; summary: string; lastUsedAt: string | null }>;
  /** Per country: contacts on file and messages sent, sorted by contacts. */
  pool: Array<{ country: string; contacts: number; sent: number }>;
  /** One row per bucket with a column per country series, plus the bucket CTR. */
  buckets: { series: string[]; rows: SeriesRow[]; ctr: Record<string, number> };
  underSent: {
    rows: Array<{ country: string; good: number; under: number }>;
    good: number;
    under: number;
  };
}

/**
 * The Contacts tab: Lists and Segments cards, contacts on file vs messages sent, the
 * send-count distribution by country with the CTR dot, and the good contacts not sent to
 * with the adjustable threshold.
 */
export function ContactsTab({
  query,
  lists,
  segments,
  pool,
  buckets,
  underSent,
}: ContactsTabProps) {
  const router = useRouter();
  const [threshold, setThreshold] = useState(String(query.threshold));
  const go = (next: Partial<DashboardQuery>) =>
    router.push(`/${dashboardQueryString({ ...query, ...next })}`, { scroll: false });
  const onThreshold = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const n = Number.parseInt(threshold, 10);
    if (Number.isFinite(n) && n >= 0) go({ threshold: n });
  };
  const poolData = pool.map((p) => ({
    country: countryName(p.country),
    contacts: p.contacts,
    sent: p.sent,
  }));
  const bucketData: Array<Record<string, number | string>> = buckets.rows.map((r) => ({
    ...r,
    ctr: buckets.ctr[r.period] ?? 0,
  }));
  const pctOfGood = underSent.good > 0 ? underSent.under / underSent.good : 0;

  return (
    <div className="space-y-4" data-testid="contacts-tab">
      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3" data-testid="lists-card">
          <CardHeader title="Lists" note={`${int(lists.total)} items`} />
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>List</TableHead>
                <TableHead className="text-right">Contacts</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lists.rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={2} className="py-6 text-center text-muted">
                    No lists yet.
                  </TableCell>
                </TableRow>
              ) : (
                lists.rows.map((l) => (
                  <TableRow key={l.id} data-testid="lists-card-row">
                    <TableCell className="max-w-[22rem]">
                      <Link
                        href={`/lists/${l.id}`}
                        className="block truncate hover:underline"
                        title={l.name}
                      >
                        {l.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {int(l.contacts)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          <div className="border-t border-rule px-4 py-2">
            <PaginationBar
              style="page-of"
              page={query.listsPage}
              pageSize={lists.pageSize}
              total={lists.total}
              onPageChange={(page) => go({ listsPage: page })}
            />
          </div>
        </Card>
        <Card className="lg:col-span-2" data-testid="segments-card">
          <CardHeader title="Segments" note={`${int(segments.length)} shown`} />
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Segment</TableHead>
                <TableHead>Definition</TableHead>
                <TableHead>Last used</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {segments.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="py-6 text-center text-muted">
                    No segments yet.
                  </TableCell>
                </TableRow>
              ) : (
                segments.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="max-w-[12rem]">
                      <Link
                        href={`/segments/${s.id}`}
                        className="block truncate hover:underline"
                        title={s.name}
                      >
                        {s.name}
                      </Link>
                    </TableCell>
                    <TableCell className="max-w-[14rem] truncate text-muted" title={s.summary}>
                      {s.summary || "—"}
                    </TableCell>
                    <TableCell className="text-muted">
                      {s.lastUsedAt ? formatDateTime(s.lastUsedAt) : "—"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>
      </div>

      <ChartFrame
        title="Contacts on file vs messages sent"
        subtitle={`Pool size against total sends · ${pool.length} countries, sorted by contacts.`}
        empty={pool.length === 0}
        table={
          <ChartTable
            columns={["Country", "Contacts on file", "Messages sent"]}
            rows={poolData.map((p) => [p.country, int(p.contacts), int(p.sent)])}
          />
        }
        testId="chart-pool"
      >
        <GroupedHBars
          data={poolData}
          xKey="country"
          series={[
            { key: "contacts", label: "Contacts on file" },
            { key: "sent", label: "Messages sent" },
          ]}
        />
      </ChartFrame>

      <ChartFrame
        title="Send-count distribution by country"
        subtitle="Good (sendable) contacts grouped by how many SMS they've received. Left-heavy bars = large idle pools worth activating. Stacked by country (top 8 + Other). The dot is the CTR of the messages sent to each group (top axis) — watch it decay as send counts climb."
        empty={buckets.rows.length === 0}
        table={
          <ChartTable
            columns={["Sent", "CTR", ...buckets.series.map(countryLabel)]}
            rows={bucketData.map((r) => [
              String(r.period),
              pct(Number(r.ctr)),
              ...buckets.series.map((s) => int(Number(r[s] ?? 0))),
            ])}
          />
        }
        testId="chart-send-buckets"
      >
        <StackedHBarsWithDot
          data={bucketData}
          xKey="period"
          series={buckets.series.map((key) => ({ key, label: countryLabel(key) }))}
          dotKey="ctr"
          dotLabel="CTR of messages sent"
          format={(v, key) => (key === "ctr" ? pct(v) : int(v))}
        />
      </ChartFrame>

      <Card data-testid="under-sent">
        <CardHeader
          title="Good contacts we're not sending to"
          actions={
            <form onSubmit={onThreshold} className="flex items-center gap-2 text-sm">
              <span className="text-muted">Sent fewer than</span>
              <Input
                type="number"
                min={0}
                max={1000}
                aria-label="Threshold"
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
                onBlur={(e) => e.currentTarget.form?.requestSubmit()}
                className="h-8 w-16 text-center"
                data-testid="threshold-input"
              />
              <span className="text-muted">times</span>
            </form>
          }
        />
        <p className="px-4 pt-3 text-xs text-muted">
          Sendable contacts on file that receive too few messages · {underSent.rows.length}{" "}
          countries · {int(underSent.under)} of {int(underSent.good)} good contacts sent fewer than{" "}
          {query.threshold} times
          {underSent.good > 0 ? ` (${pct(pctOfGood, 0)})` : ""}.
        </p>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Country</TableHead>
              <TableHead className="text-right">Good contacts</TableHead>
              <TableHead className="text-right">Sent &lt; {query.threshold} times</TableHead>
              <TableHead className="text-right">% of good</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {underSent.rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="py-6 text-center text-muted">
                  No good contacts on file.
                </TableCell>
              </TableRow>
            ) : (
              underSent.rows.map((r) => (
                <TableRow key={r.country} data-testid="under-sent-row" data-country={r.country}>
                  <TableCell>
                    <span aria-hidden="true">{flagEmoji(r.country)}</span> {countryName(r.country)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{int(r.good)}</TableCell>
                  <TableCell
                    className="text-right font-mono tabular-nums"
                    data-testid="under-sent-count"
                  >
                    {int(r.under)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {pct(r.good > 0 ? r.under / r.good : 0, 0)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
      <p className="sr-only">{SEND_BUCKETS.join(", ")}</p>
    </div>
  );
}
