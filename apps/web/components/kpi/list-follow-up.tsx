"use client";

import { countryName, countryOptions, flagEmoji } from "@sendex/core";
import {
  Badge,
  Button,
  Card,
  CountPill,
  CountryMultiSelect,
  type DateRange,
  DateRangePicker,
  EmptyState,
  Input,
  PageHeader,
  SimpleSelect,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@sendex/ui";
import { ChevronDown, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, Fragment, useState } from "react";
import { formatNumber } from "../../lib/format";
import { type ListFollowUpQuery, listFollowUpQueryString } from "../../lib/kpi-params";
import { eur, percent, shortDay } from "./format";

/** Counters as they cross the server boundary: micro-EUR as strings, ratios worked out. */
export interface FollowUpNumbers {
  sent: number;
  leads: number;
  sales: number;
  costMicro: string;
  revenueMicro: string;
  /** Sales per lead, 0..1. */
  leadToSale: number | null;
  /** Profit over cost. */
  roi: number | null;
  lastSentAt: string | null;
}

export interface FollowUpListView extends FollowUpNumbers {
  listId: string;
  name: string;
  country: string;
  provider: string | null;
  numbersCount: number;
  createdAt: string;
}

export interface FollowUpCountryView extends FollowUpNumbers {
  country: string;
  totalLists: number;
  lists: FollowUpListView[];
}

export interface FollowUpOption {
  id: string;
  name: string;
}

const ALL = "all";
const COUNTRIES = countryOptions.map((c) => ({ code: c.code, name: c.name, flag: c.flag }));

/**
 * List Follow-Up (D5-03), after the screen of that name in the Business KPIs Manager
 * walkthrough: every country with the lists that were sent, when they were last sent and what
 * they produced; under it the lists that have not been touched. The filters narrow it to a
 * route, an offer, countries and dates; with an offer picked, "not sent yet" reads as "never
 * sent to this offer".
 */
export function ListFollowUp({
  query,
  routes,
  offers,
  countries,
  untouched,
}: {
  query: ListFollowUpQuery;
  routes: readonly FollowUpOption[];
  offers: readonly FollowUpOption[];
  countries: readonly FollowUpCountryView[];
  untouched: readonly FollowUpListView[];
}) {
  const router = useRouter();
  const [search, setSearch] = useState(query.q);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());

  const navigate = (next: Partial<ListFollowUpQuery>) =>
    router.push(`/kpi/list-follow-up${listFollowUpQueryString({ ...query, ...next })}`);
  const onSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    navigate({ q: search.trim() });
  };
  const toggle = (country: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(country)) next.delete(country);
      else next.add(country);
      return next;
    });

  const offerName = offers.find((o) => o.id === query.offer)?.name;
  const filtered = Boolean(
    query.q || query.route || query.offer || query.countries.length || query.from || query.to,
  );
  const usedLists = countries.reduce((n, c) => n + c.totalLists, 0);

  return (
    <section className="space-y-4" data-testid="list-follow-up">
      <PageHeader
        breadcrumb={[{ label: "Performance" }, { label: "List Follow-Up" }]}
        title="List Follow-Up"
        subtitle="Which lists were used, what they produced, and which are still untouched."
      />

      <div className="flex flex-wrap items-center gap-3" data-testid="follow-up-filters">
        <form onSubmit={onSearch}>
          <Input
            aria-label="Search list name"
            placeholder="Search list name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-48"
            data-testid="follow-up-search"
          />
        </form>
        <SimpleSelect
          aria-label="Route"
          value={query.route || ALL}
          onValueChange={(value) => navigate({ route: value === ALL ? "" : value })}
          options={[
            { value: ALL, label: "All routes" },
            ...routes.map((r) => ({ value: r.id, label: `Route ${r.name}` })),
          ]}
          className="w-40"
        />
        <SimpleSelect
          aria-label="Offer"
          value={query.offer || ALL}
          onValueChange={(value) => navigate({ offer: value === ALL ? "" : value })}
          options={[
            { value: ALL, label: "All offers" },
            ...offers.map((o) => ({ value: o.id, label: o.name })),
          ]}
          className="w-44"
        />
        <CountryMultiSelect
          countries={COUNTRIES}
          value={query.countries}
          onChange={(next) => navigate({ countries: next })}
        />
        <DateRangePicker
          value={{ from: query.from, to: query.to }}
          onChange={(range: DateRange) => navigate({ from: range.from, to: range.to })}
        />
        {filtered ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setSearch("");
              router.push("/kpi/list-follow-up");
            }}
            data-testid="follow-up-clear"
          >
            Clear filters
          </Button>
        ) : null}
        <div className="ml-auto">
          <CountPill count={usedLists} noun="sent list" testId="follow-up-used-count" />
        </div>
      </div>

      {countries.length === 0 ? (
        <EmptyState
          title="No list was sent in these filters"
          hint="Change the route, offer, countries or dates, or send a campaign first."
        />
      ) : (
        <Table data-testid="follow-up-table">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-8" />
              <TableHead>Country / list</TableHead>
              <TableHead className="text-right">Lists</TableHead>
              <TableHead>Last sent</TableHead>
              <TableHead className="text-right">Sent</TableHead>
              <TableHead className="text-right">Leads</TableHead>
              <TableHead className="text-right">Sales</TableHead>
              <TableHead className="text-right">Lead → sale</TableHead>
              <TableHead className="text-right">Cost</TableHead>
              <TableHead className="text-right">Revenue</TableHead>
              <TableHead className="text-right">ROI</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {countries.map((c) => {
              const expanded = open.has(c.country);
              return (
                <Fragment key={c.country}>
                  <TableRow data-testid="follow-up-country-row" data-country={c.country}>
                    <TableCell>
                      <button
                        type="button"
                        onClick={() => toggle(c.country)}
                        aria-expanded={expanded}
                        aria-label={`${expanded ? "Hide" : "Show"} the lists of ${countryName(c.country)}`}
                        className="rounded p-1 text-muted hover:text-ink"
                      >
                        {expanded ? (
                          <ChevronDown className="h-4 w-4" aria-hidden="true" />
                        ) : (
                          <ChevronRight className="h-4 w-4" aria-hidden="true" />
                        )}
                      </button>
                    </TableCell>
                    <TableCell className="font-medium text-ink">
                      {flagEmoji(c.country)} {countryName(c.country)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums" data-col="lists">
                      {formatNumber(c.totalLists)}
                    </TableCell>
                    <NumberCells numbers={c} />
                  </TableRow>
                  {expanded
                    ? c.lists.map((l) => (
                        <TableRow
                          key={l.listId}
                          className="bg-neutral-50"
                          data-testid="follow-up-list-row"
                          data-list={l.name}
                        >
                          <TableCell />
                          <TableCell className="pl-8">
                            <Link href={`/lists/${l.listId}`} className="text-navy hover:underline">
                              {l.name}
                            </Link>{" "}
                            {l.provider ? <Badge variant="code">{l.provider}</Badge> : null}
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs tabular-nums text-muted">
                            {formatNumber(l.numbersCount)} numbers
                          </TableCell>
                          <NumberCells numbers={l} />
                        </TableRow>
                      ))
                    : null}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      )}

      <Card className="p-5" data-testid="follow-up-untouched">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-ink">
            {offerName ? `Never sent to ${offerName}` : "Not sent yet"}
          </h2>
          <CountPill count={untouched.length} noun="list" testId="follow-up-untouched-count" />
        </div>
        <p className="mt-1 text-xs text-muted">
          Lists with no SMS inside the filters above. Archived lists are left out.
        </p>
        {untouched.length === 0 ? (
          <p className="mt-3 text-sm text-muted">Every list in these filters has been sent.</p>
        ) : (
          <Table className="mt-3">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>List</TableHead>
                <TableHead>Country</TableHead>
                <TableHead>Data provider</TableHead>
                <TableHead className="text-right">Numbers</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {untouched.map((l) => (
                <TableRow key={l.listId} data-testid="untouched-row" data-list={l.name}>
                  <TableCell>
                    <Link href={`/lists/${l.listId}`} className="text-navy hover:underline">
                      {l.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    {flagEmoji(l.country)} {countryName(l.country)}
                  </TableCell>
                  <TableCell>{l.provider ?? "–"}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatNumber(l.numbersCount)}
                  </TableCell>
                  <TableCell>{shortDay(l.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </section>
  );
}

/** The eight figure columns shared by a country row and a list row. */
function NumberCells({ numbers }: { numbers: FollowUpNumbers }) {
  const cell = "text-right font-mono tabular-nums";
  return (
    <>
      <TableCell data-col="last-sent">{shortDay(numbers.lastSentAt)}</TableCell>
      <TableCell className={cell} data-col="sent">
        {formatNumber(numbers.sent)}
      </TableCell>
      <TableCell className={cell} data-col="leads">
        {formatNumber(numbers.leads)}
      </TableCell>
      <TableCell className={cell} data-col="sales">
        {formatNumber(numbers.sales)}
      </TableCell>
      <TableCell className={cell} data-col="lead-to-sale">
        {percent(numbers.leadToSale)}
      </TableCell>
      <TableCell className={cell} data-col="cost">
        {eur(numbers.costMicro)}
      </TableCell>
      <TableCell className={cell} data-col="revenue">
        {eur(numbers.revenueMicro)}
      </TableCell>
      <TableCell
        className={`${cell} ${numbers.roi !== null && numbers.roi < 0 ? "text-signal" : ""}`}
        data-col="roi"
      >
        {percent(numbers.roi)}
      </TableCell>
    </>
  );
}
