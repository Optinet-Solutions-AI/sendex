"use client";

import { countryName, countryOptions, flagEmoji } from "@sendex/core";
import {
  Button,
  Card,
  CardHeader,
  CountryMultiSelect,
  cn,
  type DateRange,
  DateRangePicker,
  IconButton,
  KpiStrip,
  SegmentedControl,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useToast,
} from "@sendex/ui";
import { Download, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState, useTransition } from "react";
import {
  deleteEnrichmentRuleAction,
  upsertEnrichmentRuleAction,
} from "../../app/(dashboard)/enrichment/actions";
import { type RouteRange, type RoutesQuery, routesQueryString } from "../../lib/routes-params";
import { ErrorText, inputClass } from "../campaigns/ui";
import { eur, int } from "../dashboard/format";

export interface RuleView {
  id: string;
  country: string;
  dailyLimit: number;
  monthlyBudgetMicro: number;
  onSchedule: boolean;
  afterUpload: boolean;
  asYouSend: boolean;
  includeArchived: boolean;
  active: boolean;
}

export interface EnrichmentPageProps {
  query: RoutesQuery;
  kpis: { totalUnique: number; scanned: number; good: number; bad: number; notChecked: number };
  rules: RuleView[];
  log: Array<{
    day: string;
    country: string;
    total: number;
    good: number;
    bad: number;
    noVerdict: number;
  }>;
  networks: Array<{ country: string; operator: string; numbers: number; ported: number }>;
  coverage: Array<{ country: string; route: string; method: string; priceMicro: number }>;
  canManage: boolean;
  lookupConfigured: boolean;
}

const COUNTRIES = countryOptions.map((c) => ({ code: c.code, name: c.name, flag: c.flag }));
const RANGES: ReadonlyArray<{ value: RouteRange; label: string }> = [
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "90d", label: "90d" },
  { value: "all", label: "All" },
  { value: "custom", label: "Custom" },
];

/**
 * Contacts › Enrichment (Numbers Verification): the KPI strip, the Enrichment rules card with
 * its inline Add rule form, the Verification log, the Country network breakdown and the
 * Verification coverage.
 */
export function EnrichmentPage({
  query,
  kpis,
  rules,
  log,
  networks,
  coverage,
  canManage,
  lookupConfigured,
}: EnrichmentPageProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [adding, setAdding] = useState(false);
  const [coverageCountry, setCoverageCountry] = useState(coverage[0]?.country ?? "");
  const [, start] = useTransition();
  const go = (next: Partial<RoutesQuery>) =>
    router.push(`/enrichment${routesQueryString({ ...query, ...next }, "30d")}`);
  const remove = (id: string) =>
    start(async () => {
      const result = await deleteEnrichmentRuleAction({ id });
      if (!result.ok) toast({ title: result.error, variant: "error" });
      else router.refresh();
    });
  const cover = coverage.find((c) => c.country === coverageCountry) ?? null;
  const exportHref = `/enrichment/export${routesQueryString(query, "30d")}`;

  return (
    <div className="space-y-5" data-testid="enrichment-page">
      <KpiStrip
        items={[
          { label: "Total unique numbers", value: int(kpis.totalUnique), testId: "kpi-total" },
          { label: "Total scanned", value: int(kpis.scanned), testId: "kpi-scanned" },
          { label: "Total good", value: int(kpis.good), tone: "good", testId: "kpi-good" },
          { label: "Total bad", value: int(kpis.bad), tone: "bad", testId: "kpi-bad" },
          { label: "Not checked", value: int(kpis.notChecked), testId: "kpi-not-checked" },
        ]}
      />
      {!lookupConfigured ? (
        <p
          className="rounded-md border border-amber/30 bg-amber-soft px-3 py-2 text-sm text-amber"
          data-testid="lookup-note"
        >
          No HLR / MNP lookup provider is connected yet. Rules and HLR Verify queue requests; they
          run once a provider is configured on the worker.
        </p>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-3">
          <Card data-testid="rules-card">
            <CardHeader
              title="Enrichment rules"
              note="Verify new numbers in a country automatically, within limits you set."
              actions={
                canManage ? (
                  <Button
                    size="sm"
                    onClick={() => setAdding(true)}
                    disabled={adding}
                    data-testid="add-rule"
                  >
                    <Plus className="h-4 w-4" aria-hidden="true" /> Add rule
                  </Button>
                ) : null
              }
            />
            <div className="p-4">
              {adding ? <RuleForm onClose={() => setAdding(false)} /> : null}
              {rules.length === 0 && !adding ? (
                <p className="text-sm text-muted" data-testid="rules-empty">
                  No rules yet. Add one to keep a country's numbers verified automatically.
                </p>
              ) : rules.length > 0 ? (
                <ul className="divide-y divide-rule rounded-md border border-rule">
                  {rules.map((r) => (
                    <li
                      key={r.id}
                      className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm"
                      data-testid="rule-row"
                      data-country={r.country}
                    >
                      <span className="font-medium">
                        <span aria-hidden="true">{flagEmoji(r.country)}</span>{" "}
                        {countryName(r.country)}
                      </span>
                      <span className="font-mono text-xs text-muted">
                        {int(r.dailyLimit)}/day · {eur(r.monthlyBudgetMicro)}/month
                      </span>
                      <span className="text-xs text-muted">
                        {[
                          r.onSchedule && "on a schedule",
                          r.afterUpload && "after an upload",
                          r.asYouSend && "as you send",
                        ]
                          .filter(Boolean)
                          .join(" · ") || "manual"}
                        {r.includeArchived ? " · archived lists" : ""}
                      </span>
                      {canManage ? (
                        <IconButton
                          label={`Remove rule for ${countryName(r.country)}`}
                          tooltip="Remove"
                          icon={<Trash2 />}
                          tone="danger"
                          className="ml-auto"
                          onClick={() => remove(r.id)}
                          data-testid="rule-remove"
                        />
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </Card>

          <Card data-testid="verification-log">
            <CardHeader
              title="Verification log"
              actions={
                <Button variant="outline" size="sm" asChild>
                  <a href={exportHref}>
                    <Download className="h-4 w-4" aria-hidden="true" /> Download summary
                  </a>
                </Button>
              }
            />
            <div className="flex flex-wrap items-center gap-2 px-4 pt-3">
              <SegmentedControl
                label="Period"
                size="sm"
                testIdPrefix="log-range"
                value={query.range}
                options={RANGES}
                onChange={(range) => go({ range })}
              />
              {query.range === "custom" ? (
                <DateRangePicker
                  value={{ from: query.from, to: query.to }}
                  onChange={(r: DateRange) => go({ range: "custom", from: r.from, to: r.to })}
                />
              ) : null}
              <CountryMultiSelect
                countries={COUNTRIES}
                value={query.countries.slice(0, 1)}
                onChange={(c) => go({ countries: c.slice(-1) })}
                prefix="Any country:"
              />
            </div>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Date ↓</TableHead>
                  <TableHead>Country</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Good</TableHead>
                  <TableHead className="text-right">Bad</TableHead>
                  <TableHead className="text-right">No verdict</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {log.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-muted">
                      No verification requests in this window.
                    </TableCell>
                  </TableRow>
                ) : (
                  log.map((r) => (
                    <TableRow key={`${r.day}:${r.country}`} data-testid="log-row">
                      <TableCell className="tabular-nums">{r.day}</TableCell>
                      <TableCell>
                        <span aria-hidden="true">{flagEmoji(r.country)}</span>{" "}
                        {countryName(r.country)}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {int(r.total)}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums text-good">
                        {int(r.good)}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums text-signal">
                        {int(r.bad)}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {int(r.noVerdict)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Card>
        </div>

        <div className="space-y-4 lg:col-span-2">
          <Card data-testid="network-breakdown">
            <CardHeader title="Country network breakdown" />
            {networks.length === 0 ? (
              <p className="p-4 text-sm text-muted">No verification activity yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Country</TableHead>
                    <TableHead>Operator</TableHead>
                    <TableHead className="text-right">Numbers</TableHead>
                    <TableHead className="text-right">Ported</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {networks.map((n) => (
                    <TableRow key={`${n.country}:${n.operator}`}>
                      <TableCell>
                        <span aria-hidden="true">{flagEmoji(n.country)}</span> {n.country}
                      </TableCell>
                      <TableCell>{n.operator}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {int(n.numbers)}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {int(n.ported)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
          <Card data-testid="coverage">
            <CardHeader title="Verification coverage" />
            <div className="space-y-3 p-4">
              <select
                className={inputClass}
                aria-label="Coverage country"
                value={coverageCountry}
                onChange={(e) => setCoverageCountry(e.target.value)}
                data-testid="coverage-country"
              >
                {coverage.length === 0 ? <option value="">No lookup routes yet</option> : null}
                {coverage.map((c) => (
                  <option key={c.country} value={c.country}>
                    {c.country} {countryName(c.country)}
                  </option>
                ))}
              </select>
              {cover ? (
                <table className="w-full text-sm">
                  <thead className="text-left font-mono text-[11px] uppercase tracking-[0.06em] text-muted">
                    <tr>
                      <th className="py-1">Route</th>
                      <th className="py-1">Method</th>
                      <th className="py-1 text-right">Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr data-testid="coverage-row">
                      <td className="py-1">{cover.route}</td>
                      <td className="py-1 uppercase">{cover.method}</td>
                      <td className="py-1 text-right font-mono tabular-nums">
                        €{(cover.priceMicro / 1_000_000).toFixed(4)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              ) : (
                <p className="text-sm text-muted">
                  This is the lookup price per number for that country.
                </p>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function RuleForm({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { toast } = useToast();
  const [country, setCountry] = useState("");
  const [dailyLimit, setDailyLimit] = useState("5000");
  const [budget, setBudget] = useState("25");
  const [onSchedule, setOnSchedule] = useState(true);
  const [afterUpload, setAfterUpload] = useState(false);
  const [asYouSend, setAsYouSend] = useState(false);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    start(async () => {
      const result = await upsertEnrichmentRuleAction({
        country,
        dailyLimit,
        monthlyBudgetEur: budget,
        onSchedule,
        afterUpload,
        asYouSend,
        includeArchived,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast({ title: "Rule created", variant: "success" });
      onClose();
      router.refresh();
    });
  };
  const check = (
    label: string,
    hint: string,
    value: boolean,
    set: (v: boolean) => void,
    testId: string,
  ) => (
    <label className="flex items-start gap-2 text-sm">
      <input
        type="checkbox"
        className="mt-1"
        checked={value}
        onChange={(e) => set(e.target.checked)}
        data-testid={testId}
      />
      <span>
        <span className="font-medium text-ink">{label}</span>{" "}
        <span className="text-muted">— {hint}</span>
      </span>
    </label>
  );
  return (
    <form
      onSubmit={submit}
      className="mb-4 space-y-3 rounded-md border border-rule bg-page p-4"
      data-testid="rule-form"
    >
      <div className="grid gap-3 md:grid-cols-3">
        <label className="block text-sm">
          <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted">
            Country
          </span>
          <select
            className={inputClass}
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            data-testid="rule-country"
          >
            <option value="">Select country</option>
            {countryOptions.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted">
            Daily limit (numbers)
          </span>
          <input
            className={inputClass}
            inputMode="numeric"
            value={dailyLimit}
            onChange={(e) => setDailyLimit(e.target.value)}
            data-testid="rule-daily"
          />
          <span className="text-xs text-muted">Numbers verified per day</span>
        </label>
        <label className="block text-sm">
          <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted">
            Monthly budget (EUR)
          </span>
          <input
            className={inputClass}
            inputMode="decimal"
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
            data-testid="rule-budget"
          />
          <span className="text-xs text-muted">Max spend per calendar month</span>
        </label>
      </div>
      <fieldset className="space-y-1">
        <legend className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted">
          When to run
        </legend>
        {check(
          "On a schedule",
          "Checked regularly in the background",
          onSchedule,
          setOnSchedule,
          "rule-on-schedule",
        )}
        {check(
          "After an upload",
          "New lists jump the queue",
          afterUpload,
          setAfterUpload,
          "rule-after-upload",
        )}
        {check(
          "As you send",
          "Prioritises the countries you actually message",
          asYouSend,
          setAsYouSend,
          "rule-as-you-send",
        )}
      </fieldset>
      <fieldset className="space-y-1">
        <legend className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted">
          Which numbers
        </legend>
        {check(
          "Include archived lists",
          "off by default; archived lists can hold far more numbers than active ones",
          includeArchived,
          setIncludeArchived,
          "rule-archived",
        )}
      </fieldset>
      <ErrorText error={error} />
      <div className="flex gap-2">
        <Button type="submit" disabled={!country || pending} data-testid="rule-create">
          Create rule
        </Button>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
      </div>
      <span className={cn("sr-only")}>{pending ? "Saving" : ""}</span>
    </form>
  );
}
