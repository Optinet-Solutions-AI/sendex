"use client";

import {
  Card,
  CardHeader,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  UnderlineTabs,
} from "@sendex/ui";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import {
  type AssetTab,
  type DashboardQuery,
  dashboardQueryString,
} from "../../lib/dashboard-params";
import { timeAgo } from "../../lib/format";
import { eur, int, pct } from "./format";

export interface AssetRowView {
  key: string;
  label: string;
  sublabel: string | null;
  sent: number;
  delivered: number;
  clicks: number;
  leads: number;
  sales: number;
  spendMicro: number;
  lastSentAt: string | null;
}

export interface AssetsTabProps {
  query: DashboardQuery;
  rows: AssetRowView[];
  total: number;
  now: string;
}

const SUB_TABS: ReadonlyArray<{ value: AssetTab; label: string }> = [
  { value: "texts", label: "SMS Texts" },
  { value: "offers", label: "Offers" },
  { value: "sids", label: "Sender IDs" },
];

const COPY: Record<
  AssetTab,
  {
    title: string;
    subtitle: (n: number, shown: number) => string;
    placeholder: string;
    column: string;
  }
> = {
  texts: {
    title: "SMS Texts performance",
    subtitle: (n, shown) =>
      `How each message body performed. Ranked by messages sent. Showing the top ${int(shown)} of ${int(n)} · ${"all-time"}.`,
    placeholder: "Search sms texts…",
    column: "Text",
  },
  offers: {
    title: "Offers performance",
    subtitle: (n) =>
      `How each offer performed across every campaign that promoted it. Links pointing straight at a URL are listed as "(no link)". ${int(n)} in view · all-time.`,
    placeholder: "Search offers…",
    column: "Offer",
  },
  sids: {
    title: "Sender IDs performance",
    subtitle: (n) =>
      `How each sender ID performed — delivery rate is the one to watch here. ${int(n)} in view · all-time.`,
    placeholder: "Search sender ids…",
    column: "Sender ID",
  },
};

/**
 * The Assets tab: SMS Texts, Offers and Sender IDs performance tables, each with its own
 * search box, in a card with a fixed header row.
 */
export function AssetsTab({ query, rows, total, now }: AssetsTabProps) {
  const router = useRouter();
  const [search, setSearch] = useState(query.q);
  const go = (next: Partial<DashboardQuery>) =>
    router.push(`/${dashboardQueryString({ ...query, ...next })}`, { scroll: false });
  const onSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    go({ q: search.trim() });
  };
  const copy = COPY[query.asset];
  const nowDate = new Date(now);
  const windowed = query.range !== "all";
  return (
    <div className="space-y-4" data-testid="assets-tab">
      <div className="flex flex-wrap items-center gap-3">
        <UnderlineTabs
          label="Asset kind"
          value={query.asset}
          tabs={SUB_TABS}
          onChange={(asset) => {
            setSearch("");
            go({ asset, q: "" });
          }}
        />
        <form onSubmit={onSearch} className="ml-auto">
          <Input
            type="search"
            aria-label={copy.placeholder}
            placeholder={copy.placeholder}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-64"
            data-testid="asset-search"
          />
        </form>
      </div>
      <Card>
        <CardHeader title={copy.title} />
        <p className="px-4 pt-3 text-xs text-muted">
          {copy
            .subtitle(total, Math.min(total, rows.length))
            .replace("all-time", windowed ? "in the selected period" : "all-time")}
        </p>
        <div className="max-h-[32rem] overflow-auto p-4 pt-3">
          <Table data-testid="assets-table">
            <TableHeader className="sticky top-0 z-10">
              <TableRow className="hover:bg-transparent">
                <TableHead>{copy.column}</TableHead>
                <TableHead className="text-right">↓ Sent</TableHead>
                <TableHead className="text-right">Delivered</TableHead>
                <TableHead className="text-right">Clicks</TableHead>
                <TableHead className="text-right">CTR</TableHead>
                <TableHead className="text-right">CPC</TableHead>
                <TableHead className="text-right">Signups</TableHead>
                <TableHead className="text-right">Sales</TableHead>
                <TableHead className="text-right">Cost / sale</TableHead>
                <TableHead className="text-right">Spend</TableHead>
                <TableHead>Last sent</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={11} className="py-8 text-center text-muted">
                    Nothing sent yet{query.q ? ` that matches "${query.q}"` : ""}.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r) => (
                  <TableRow key={r.key} data-testid="asset-row">
                    <TableCell className="max-w-[20rem] whitespace-normal">
                      <div className="truncate text-ink" title={r.label}>
                        {r.label}
                      </div>
                      {r.sublabel ? (
                        <div
                          className="truncate font-mono text-[11px] text-muted"
                          title={r.sublabel}
                        >
                          {r.sublabel}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell
                      className="text-right font-mono tabular-nums"
                      data-testid="asset-sent"
                    >
                      {int(r.sent)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {pct(r.sent > 0 ? r.delivered / r.sent : 0, 1)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {int(r.clicks)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {pct(r.sent > 0 ? r.clicks / r.sent : 0)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {r.clicks > 0 ? eur(r.spendMicro / r.clicks) : "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {int(r.leads)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {int(r.sales)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {r.sales > 0 ? eur(r.spendMicro / r.sales) : "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {eur(r.spendMicro)}
                    </TableCell>
                    <TableCell className="text-muted">{timeAgo(r.lastSentAt, nowDate)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
