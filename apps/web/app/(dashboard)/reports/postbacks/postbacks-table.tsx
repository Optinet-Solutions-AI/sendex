"use client";

import {
  Badge,
  Button,
  CountPill,
  cn,
  Input,
  PageHeader,
  PaginationBar,
  SegmentedControl,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@sendex/ui";
import { ChevronDown, Download, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, Fragment, useState } from "react";
import { formatMicro } from "../../../../components/campaigns/format";
import {
  type PostbackRange,
  type PostbacksQuery,
  type PostbackTimingFilter,
  type PostbackTypeFilter,
  postbacksQueryString,
} from "../../../../lib/postbacks-params";

export interface PostbackTableRow {
  id: string;
  eventKey: string;
  type: "lead" | "sale";
  dynamicId: string;
  campaignId: string | null;
  campaignName: string | null;
  valueMicro: number | null;
  params: Record<string, unknown>;
  receivedAt: string;
  /** When the attributed SMS went out; null when the postback matched no message. */
  messageSentAt: string | null;
  timing: "same_day" | "late" | null;
  daysLater: number | null;
}

interface PostbacksTableProps {
  rows: PostbackTableRow[];
  total: number;
  pageSize: number;
  query: PostbacksQuery;
}

const TYPE_OPTIONS: ReadonlyArray<{ value: PostbackTypeFilter; label: string }> = [
  { value: "all", label: "All events" },
  { value: "lead", label: "Leads" },
  { value: "sale", label: "Sales" },
];

const TIMING_OPTIONS: ReadonlyArray<{ value: PostbackTimingFilter; label: string }> = [
  { value: "all", label: "Any timing" },
  { value: "same_day", label: "Same day" },
  { value: "late", label: "Late" },
];

const RANGE_OPTIONS: ReadonlyArray<{ value: Exclude<PostbackRange, "custom">; label: string }> = [
  { value: "all", label: "All time" },
  { value: "today", label: "Today" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
];

/** Parameters other than the ones shown in their own columns, as `key=value` pairs. */
export function summariseParams(params: Record<string, unknown>): string {
  return Object.entries(params)
    .filter(([key]) => key !== "type" && key !== "dynamic_id" && key !== "key")
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(" ");
}

/** "2026-11-07 08:15:18" in UTC, split so the time can render lighter. */
export function splitReceived(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: "—", time: "" };
  const s = d.toISOString();
  return { date: s.slice(0, 10), time: s.slice(11, 19) };
}

/**
 * "Same day" when the conversion came on the UTC day its SMS was sent, "Late · 3 days"
 * after that (D4-12); empty for a postback that matched no message.
 */
export function timingLabel(timing: "same_day" | "late" | null, daysLater: number | null): string {
  if (timing === null) return "";
  if (timing === "same_day") return "Same day";
  const days = daysLater ?? 0;
  return `Late · ${days} day${days === 1 ? "" : "s"}`;
}

/**
 * The Postback Logs of the spec: search, All events | Leads | Sales, All time | Today | 7 |
 * 30 | 90 days, a date range, Reset once a filter is set, the event count, Export CSV, and
 * the table with Lead / Sale badges, two-line campaign, parameters, received time and a
 * chevron that expands the row.
 */
export function PostbacksTable({ rows, total, pageSize, query }: PostbacksTableProps) {
  const router = useRouter();
  const [search, setSearch] = useState(query.search);
  const [from, setFrom] = useState(query.from);
  const [to, setTo] = useState(query.to);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const navigate = (next: Partial<PostbacksQuery>) => {
    router.push(`/reports/postbacks${postbacksQueryString({ ...query, page: 1, ...next })}`);
  };
  const onSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    navigate({ search: search.trim() });
  };
  const onDates = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!from && !to) navigate({ range: "all", from: "", to: "" });
    else navigate({ range: "custom", from, to });
  };
  const filtersActive =
    query.type !== "all" ||
    query.timing !== "all" ||
    query.range !== "all" ||
    query.search !== "" ||
    !!from ||
    !!to;
  const reset = () => {
    setSearch("");
    setFrom("");
    setTo("");
    router.push("/reports/postbacks");
  };
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <section className="space-y-4" data-testid="postback-logs">
      <PageHeader
        breadcrumb={[
          { label: "Campaigns", href: "/campaigns" },
          { label: "Reports" },
          { label: "Postback Logs" },
        ]}
        title="Postback Logs"
        subtitle="Every lead and sale your tracker reported, matched to its campaign."
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href="/settings/postbacks">Postback URL</Link>
            </Button>
            <Button variant="outline" asChild>
              <a href={`/reports/postbacks/export${postbacksQueryString(query)}`}>
                <Download className="h-4 w-4" aria-hidden="true" /> Export CSV
              </a>
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2" data-testid="postback-filters">
        <form onSubmit={onSearch} className="flex items-center gap-2">
          <Input
            type="search"
            name="search"
            placeholder="Search event key…"
            aria-label="Search postbacks"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-56"
          />
          <Button type="submit" variant="outline" size="sm">
            Search
          </Button>
        </form>
        <SegmentedControl
          label="Type"
          size="sm"
          testIdPrefix="type-filter"
          value={query.type}
          options={TYPE_OPTIONS}
          onChange={(type) => navigate({ type })}
        />
        <SegmentedControl
          label="Timing"
          size="sm"
          testIdPrefix="timing-filter"
          value={query.timing}
          options={TIMING_OPTIONS}
          onChange={(timing) => navigate({ timing })}
        />
        <SegmentedControl
          label="Period"
          size="sm"
          testIdPrefix="range-filter"
          value={query.range === "custom" ? "all" : query.range}
          options={RANGE_OPTIONS}
          onChange={(range) => {
            setFrom("");
            setTo("");
            navigate({ range, from: "", to: "" });
          }}
        />
        <form onSubmit={onDates} className="flex flex-wrap items-center gap-1.5">
          <Input
            type="date"
            aria-label="From"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="h-8 w-36 text-xs"
          />
          <span className="text-xs text-muted">to</span>
          <Input
            type="date"
            aria-label="To"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="h-8 w-36 text-xs"
          />
          <Button type="submit" variant="outline" size="sm">
            Apply
          </Button>
        </form>
        {filtersActive ? (
          <Button variant="ghost" size="sm" onClick={reset} data-testid="postbacks-reset">
            <X className="h-3.5 w-3.5" aria-hidden="true" /> Reset
          </Button>
        ) : null}
        <CountPill count={total} noun="event" className="ml-auto" testId="postbacks-count" />
      </div>

      <Table data-testid="postbacks-table">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Event Key</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Campaign</TableHead>
            <TableHead>Parameters</TableHead>
            <TableHead>Received</TableHead>
            <TableHead>Timing</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="py-10 text-center text-muted">
                No postbacks match.
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => {
              const open = expanded.has(row.id);
              const received = splitReceived(row.receivedAt);
              const timing = timingLabel(row.timing, row.daysLater);
              const extra = summariseParams(row.params);
              return (
                <Fragment key={row.id}>
                  <TableRow
                    data-testid={`postback-row-${row.eventKey}`}
                    data-expanded={open}
                    className="align-top"
                  >
                    <TableCell className="font-mono text-xs">{row.eventKey}</TableCell>
                    <TableCell>
                      <Badge variant={row.type === "sale" ? "sale" : "lead"} data-type={row.type}>
                        {row.type === "sale" ? "Sale" : "Lead"}
                      </Badge>
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      {row.campaignId ? (
                        <div className="max-w-[18rem]">
                          <Link
                            href={`/campaigns/${row.campaignId}`}
                            className="block truncate font-medium text-ink hover:underline"
                            title={row.campaignName ?? row.campaignId}
                          >
                            {row.campaignName ?? row.campaignId}
                          </Link>
                          <div className="truncate font-mono text-[11px] text-muted">
                            {row.dynamicId}
                          </div>
                        </div>
                      ) : (
                        <span className="text-muted" title="No message carried this dynamic id">
                          unattributed
                        </span>
                      )}
                    </TableCell>
                    <TableCell
                      className="max-w-xs truncate font-mono text-xs text-muted"
                      title={extra}
                    >
                      {extra || <span className="font-sans">No extra parameters</span>}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {received.date} <span className="text-muted">{received.time}</span>
                    </TableCell>
                    <TableCell data-testid="postback-timing">
                      {row.timing === null ? (
                        <span className="text-muted">—</span>
                      ) : (
                        <Badge
                          variant={row.timing === "late" ? "amber" : "secondary"}
                          data-timing={row.timing}
                          title={
                            row.messageSentAt
                              ? `SMS sent ${row.messageSentAt.slice(0, 10)} (UTC)`
                              : undefined
                          }
                        >
                          {timing}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <button
                        type="button"
                        aria-expanded={open}
                        aria-label={open ? "Collapse" : "Expand"}
                        onClick={() => toggle(row.id)}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-neutral-100 hover:text-ink"
                        data-testid="postback-expand"
                      >
                        <ChevronDown
                          className={cn("h-4 w-4 transition-transform", open && "rotate-180")}
                          aria-hidden="true"
                        />
                      </button>
                    </TableCell>
                  </TableRow>
                  {open ? (
                    <TableRow className="bg-page hover:bg-page" data-testid="postback-details">
                      <TableCell colSpan={7} className="whitespace-normal">
                        <dl className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-[auto_1fr]">
                          <dt className="font-mono uppercase tracking-[0.06em] text-muted">
                            Dynamic id
                          </dt>
                          <dd className="font-mono">{row.dynamicId}</dd>
                          <dt className="font-mono uppercase tracking-[0.06em] text-muted">
                            Value
                          </dt>
                          <dd className="tabular-nums">
                            {row.valueMicro === null ? "—" : formatMicro(row.valueMicro)}
                          </dd>
                          <dt className="font-mono uppercase tracking-[0.06em] text-muted">
                            Received
                          </dt>
                          <dd className="tabular-nums">{row.receivedAt}</dd>
                          <dt className="font-mono uppercase tracking-[0.06em] text-muted">
                            SMS sent
                          </dt>
                          <dd className="tabular-nums">
                            {row.messageSentAt ?? "—"}
                            {timing ? ` (${timing.toLowerCase()})` : ""}
                          </dd>
                          {Object.entries(row.params).map(([key, value]) => (
                            <Fragment key={key}>
                              <dt className="font-mono text-muted">{key}</dt>
                              <dd className="break-all font-mono">{String(value)}</dd>
                            </Fragment>
                          ))}
                        </dl>
                      </TableCell>
                    </TableRow>
                  ) : null}
                </Fragment>
              );
            })
          )}
        </TableBody>
      </Table>

      <PaginationBar
        style="page-of"
        page={query.page}
        pageSize={pageSize}
        total={total}
        onPageChange={(page) =>
          router.push(`/reports/postbacks${postbacksQueryString({ ...query, page })}`)
        }
      />
    </section>
  );
}
