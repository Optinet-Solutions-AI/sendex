"use client";

import { countryName, flagEmoji, type PlanDimension, type PlanGroup } from "@sendex/core";
import {
  Badge,
  Button,
  Card,
  Explained,
  Input,
  KpiStrip,
  PageHeader,
  SegmentedControl,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useToast,
} from "@sendex/ui";
import { ChevronLeft, ChevronRight, Pencil } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setDailyTargetAction } from "../../app/(dashboard)/kpi/actions";
import { formatNumber } from "../../lib/format";
import { type DailyPlanQuery, dailyPlanQueryString } from "../../lib/kpi-params";
import { differenceText, explainDifference, explainPlanContacts, KPI_FORMULAS } from "./explain";
import { shortDay } from "./format";

export interface PlannedCampaignView {
  campaignId: string;
  name: string;
  country: string;
  status: string;
  offer: string | null;
  lists: string[];
  routes: string[];
  contacts: number;
  sent: number;
}

const DIMENSIONS: ReadonlyArray<{ value: PlanDimension; label: string; column: string }> = [
  { value: "country", label: "By country", column: "Country" },
  { value: "offer", label: "By offer", column: "Offer" },
  { value: "route", label: "By route", column: "Route" },
];

/** "Route 724" for a platform route name, the name itself for a custom route. */
function routeLabel(name: string): string {
  return /^\d+$/.test(name) ? `Route ${name}` : name;
}

/**
 * The daily plan (D5-08), after "Planned Campaigns" in the Business KPIs Manager walkthrough:
 * the campaigns planned for a day, how many contacts they cover per country, offer or route,
 * and how that compares with the daily SMS target. Yesterday's plan stays on record: step
 * back a day to see it.
 */
export function DailyPlan({
  query,
  previousDay,
  nextDay,
  campaigns,
  groups,
  totals,
  canSetTarget,
}: {
  query: DailyPlanQuery;
  previousDay: string;
  nextDay: string;
  campaigns: readonly PlannedCampaignView[];
  groups: readonly PlanGroup[];
  totals: { campaigns: number; contacts: number; target: number | null; difference: number | null };
  canSetTarget: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [target, setTarget] = useState(totals.target === null ? "" : String(totals.target));
  const [pending, start] = useTransition();
  const navigate = (next: Partial<DailyPlanQuery>) =>
    router.push(`/kpi/daily-plan${dailyPlanQueryString({ ...query, ...next })}`, { scroll: false });
  const dimension = DIMENSIONS.find((d) => d.value === query.by) ?? DIMENSIONS[0];
  const groupLabel = (key: string) =>
    key.startsWith("(")
      ? key
      : query.by === "country"
        ? `${flagEmoji(key)} ${countryName(key)}`
        : query.by === "route"
          ? key.split(" + ").map(routeLabel).join(" + ")
          : key;

  const saveTarget = () => {
    start(async () => {
      const result = await setDailyTargetAction(target);
      if (!result.ok) {
        toast({ title: result.error, variant: "error" });
        return;
      }
      setEditing(false);
      toast({ title: "Daily target saved", variant: "success" });
      router.refresh();
    });
  };

  const difference = totals.difference;
  return (
    <section className="space-y-4" data-testid="daily-plan">
      <PageHeader
        breadcrumb={[{ label: "Performance" }, { label: "Daily Plan" }]}
        title="Daily Plan"
        subtitle={`${shortDay(`${query.day}T00:00:00Z`)}: the campaigns planned for the day and how they compare with the target.`}
      />

      <div className="flex flex-wrap items-center gap-3" data-testid="plan-filters">
        <div className="inline-flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            aria-label="Previous day"
            onClick={() => navigate({ day: previousDay })}
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </Button>
          <input
            type="date"
            aria-label="Day"
            value={query.day}
            onChange={(e) => (e.target.value ? navigate({ day: e.target.value }) : undefined)}
            className="rounded border border-neutral-300 px-2.5 py-1.5 text-sm"
            data-testid="plan-day"
          />
          <Button
            variant="outline"
            size="sm"
            aria-label="Next day"
            onClick={() => navigate({ day: nextDay })}
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
        <SegmentedControl
          label="Group by"
          value={query.by}
          options={DIMENSIONS.map((d) => ({ value: d.value, label: d.label }))}
          onChange={(by) => navigate({ by })}
        />
      </div>

      <KpiStrip
        label="The day"
        items={[
          { label: "Campaigns", value: formatNumber(totals.campaigns), testId: "plan-campaigns" },
          {
            label: <Explained formula={KPI_FORMULAS.planContacts}>Contacts</Explained>,
            value: (
              <Explained
                {...explainPlanContacts(
                  campaigns.map((c) => c.contacts),
                  totals.contacts,
                )}
              >
                {formatNumber(totals.contacts)}
              </Explained>
            ),
            testId: "plan-contacts",
          },
          {
            label: "Daily target",
            value: totals.target === null ? "Not set" : formatNumber(totals.target),
            testId: "plan-target",
          },
          {
            label: <Explained formula={KPI_FORMULAS.difference}>Difference</Explained>,
            value: (
              <Explained
                {...explainDifference({
                  contacts: totals.contacts,
                  target: totals.target,
                  difference,
                })}
              >
                {differenceText(difference)}
              </Explained>
            ),
            tone: difference === null ? "default" : difference < 0 ? "bad" : "good",
            hint:
              difference === null
                ? "Set a daily target to compare"
                : difference < 0
                  ? "Short of the target"
                  : "On or over the target",
            testId: "plan-difference",
          },
        ]}
      />

      {canSetTarget ? (
        <div className="text-sm">
          {editing ? (
            <form
              className="inline-flex flex-wrap items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                saveTarget();
              }}
            >
              <span className="inline-flex items-center gap-2">
                <span className="text-muted">Daily target (SMS)</span>
                <Input
                  aria-label="Daily target"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  inputMode="numeric"
                  placeholder="e.g. 100000"
                  className="h-8 w-36"
                  autoFocus
                />
              </span>
              <Button type="submit" size="sm" disabled={pending}>
                Save
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <span className="text-xs text-muted">Leave it blank for no target.</span>
            </form>
          ) : (
            <button
              type="button"
              className="inline-flex items-center gap-1 text-navy hover:underline"
              onClick={() => setEditing(true)}
              data-testid="plan-edit-target"
            >
              <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
              {totals.target === null ? "Set a daily target" : "Change the daily target"}
            </button>
          )}
        </div>
      ) : null}

      {campaigns.length === 0 ? (
        <Card className="p-6 text-sm text-muted" data-testid="plan-empty">
          Nothing is planned for {shortDay(`${query.day}T00:00:00Z`)}. Plan a campaign with{" "}
          <Link href="/kpi/list-follow-up" className="text-navy underline">
            Create Campaign
          </Link>{" "}
          on List Follow-Up.
        </Card>
      ) : (
        <>
          <Card className="p-5" data-testid="plan-groups">
            <h2 className="text-sm font-semibold text-ink">{dimension?.label}</h2>
            <Table className="mt-3">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>{dimension?.column}</TableHead>
                  <TableHead className="text-right">Campaigns</TableHead>
                  <TableHead className="text-right">
                    <Explained formula={KPI_FORMULAS.groupContacts}>Contacts</Explained>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.map((g) => (
                  <TableRow key={g.key} data-testid="plan-group-row" data-key={g.key}>
                    <TableCell className="font-medium text-ink">{groupLabel(g.key)}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatNumber(g.campaigns)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatNumber(g.contacts)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          <Card className="p-5" data-testid="plan-campaigns-card">
            <h2 className="text-sm font-semibold text-ink">Campaigns of the day</h2>
            <Table className="mt-3">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Campaign</TableHead>
                  <TableHead>Country</TableHead>
                  <TableHead>Offer</TableHead>
                  <TableHead>List</TableHead>
                  <TableHead>Route</TableHead>
                  <TableHead className="text-right">
                    <Explained formula={KPI_FORMULAS.campaignContacts}>Contacts</Explained>
                  </TableHead>
                  <TableHead className="text-right">Sent</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {campaigns.map((c) => (
                  <TableRow key={c.campaignId} data-testid="plan-campaign-row">
                    <TableCell>
                      <Link
                        href={`/campaigns/${c.campaignId}`}
                        className="text-navy hover:underline"
                      >
                        {c.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      {flagEmoji(c.country)} {countryName(c.country)}
                    </TableCell>
                    <TableCell>{c.offer ?? "–"}</TableCell>
                    <TableCell>{c.lists.join(", ") || "–"}</TableCell>
                    <TableCell>{c.routes.map(routeLabel).join(", ") || "–"}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatNumber(c.contacts)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatNumber(c.sent)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="code">{c.status}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </>
      )}
    </section>
  );
}
