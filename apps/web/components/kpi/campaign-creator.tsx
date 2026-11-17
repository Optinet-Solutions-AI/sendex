"use client";

import {
  CREATOR_PERIOD_LABELS,
  CREATOR_PERIODS,
  type CreatorPeriod,
  countryName,
  type ListOfferPair,
  type OfferCountryRow,
  rankCountriesForOffer,
  rankListsForOffer,
  rankOffersForCountry,
} from "@sendex/core";
import {
  Badge,
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  SimpleSelect,
  useToast,
} from "@sendex/ui";
import { ArrowLeft, ArrowRight, Check, Globe, List, Sparkles, Tag } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import {
  campaignCreatorDataAction,
  createPlannedCampaignAction,
} from "../../app/(dashboard)/kpi/actions";
import { formatNumber } from "../../lib/format";
import { percent, routeChoiceLabel, shortDay } from "./format";

/** What the creator ranks on, as it crosses the server boundary (money and dates as strings). */
export interface CreatorData {
  period: CreatorPeriod;
  periodLabel: string;
  offers: { id: string; name: string }[];
  lists: {
    listId: string;
    name: string;
    country: string;
    provider: string | null;
    numbersCount: number;
    /** The list's last send to any offer. */
    lastSentAt: string | null;
    /** Its sales with every offer, all time. */
    sales: number;
  }[];
  inPeriod: CountersView[];
  ever: CountersView[];
  pairsPeriod: PairView[];
  pairsEver: PairView[];
  /** Routes that can carry each list country, with the price per SMS. */
  routes: Record<string, RouteView[]>;
}

type CountersView = Omit<OfferCountryRow, "costMicro" | "revenueMicro"> & {
  costMicro: string;
  revenueMicro: string;
};
type PairView = Omit<ListOfferPair, "lastSentAt"> & { lastSentAt: string | null };
interface RouteView {
  id: string;
  name: string;
  platform: boolean;
  priceMicro: string | null;
}

type Flow = "country" | "offer" | "list";
type Step = "flow" | "first" | "second" | "lists" | "send";

const FLOWS: ReadonlyArray<{ value: Flow; title: string; hint: string; icon: typeof Globe }> = [
  { value: "country", title: "By Country", hint: "Pick a country first", icon: Globe },
  { value: "offer", title: "By Offer", hint: "Pick an offer first", icon: Tag },
  { value: "list", title: "By List", hint: "Pick a specific list", icon: List },
];

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * The campaign creator (D5-07), after "Create Campaign" in the Business KPIs Manager
 * walkthrough. Three ways in: by country (it ranks that country's offers), by offer (it ranks
 * that offer's countries) or by list. It then shows the lists never sent to the offer first,
 * asks for a route and a day, and makes a draft campaign with all of it attached. Nothing is
 * sent: the campaign is opened and sent from its own page.
 */
export function CampaignCreator({ canCreate }: { canCreate: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [period, setPeriod] = useState<CreatorPeriod>("this_month");
  const [data, setData] = useState<CreatorData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("flow");
  const [flow, setFlow] = useState<Flow | null>(null);
  const [country, setCountry] = useState("");
  const [offerId, setOfferId] = useState("");
  const [listId, setListId] = useState("");
  const [routeId, setRouteId] = useState("");
  const [plannedFor, setPlannedFor] = useState(today());
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setData(null);
    setLoadError(null);
    campaignCreatorDataAction(period).then((result) => {
      if (cancelled) return;
      if (result.ok) setData(result.data);
      else setLoadError(result.error);
    });
    return () => {
      cancelled = true;
    };
  }, [open, period]);

  const reset = () => {
    setStep("flow");
    setFlow(null);
    setCountry("");
    setOfferId("");
    setListId("");
    setRouteId("");
    setPlannedFor(today());
    setError(null);
  };

  const model = useMemo(() => {
    if (!data) return null;
    const counters = (rows: CountersView[]): OfferCountryRow[] =>
      rows.map((r) => ({
        ...r,
        costMicro: BigInt(r.costMicro),
        revenueMicro: BigInt(r.revenueMicro),
      }));
    const pairs = (rows: PairView[]): ListOfferPair[] =>
      rows.map((p) => ({ ...p, lastSentAt: p.lastSentAt ? new Date(p.lastSentAt) : null }));
    return {
      inPeriod: counters(data.inPeriod),
      ever: counters(data.ever),
      pairsPeriod: pairs(data.pairsPeriod),
      pairsEver: pairs(data.pairsEver),
      countries: [...new Set(data.lists.map((l) => l.country))].sort((a, b) =>
        countryName(a).localeCompare(countryName(b)),
      ),
    };
  }, [data]);

  const offerName = data?.offers.find((o) => o.id === offerId)?.name ?? "";
  const list = data?.lists.find((l) => l.listId === listId);
  const routes = data && country ? (data.routes[country] ?? []) : [];

  const submit = () => {
    setError(null);
    start(async () => {
      const result = await createPlannedCampaignAction({ offerId, listId, routeId, plannedFor });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast({
        title: "Campaign added",
        description: `${result.data.name}. Open it from Campaigns to add the sender IDs and the text.`,
        variant: "success",
      });
      setOpen(false);
      reset();
      router.refresh();
    });
  };

  const back = () => {
    setError(null);
    // By list there is no lists step: the list is the first choice and the offer the second.
    if (step === "send") setStep(flow === "list" ? "second" : "lists");
    else if (step === "lists") setStep("first");
    else if (step === "second") setStep("first");
    else if (step === "first") setStep("flow");
  };

  const title =
    step === "flow"
      ? "Campaign creator: choose a way in"
      : step === "send"
        ? "Route and day"
        : step === "lists"
          ? "Select a list"
          : flow === "country"
            ? "Select a country"
            : flow === "offer"
              ? "Select an offer"
              : step === "first"
                ? "Select a list"
                : "Select an offer";

  if (!canCreate) return null;

  return (
    <>
      <Button
        onClick={() => {
          reset();
          setOpen(true);
        }}
        data-testid="open-campaign-creator"
      >
        <Sparkles className="h-4 w-4" aria-hidden="true" /> Create Campaign
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="max-h-[90vh] max-w-2xl overflow-y-auto"
          data-testid="campaign-creator"
        >
          <DialogTitle className="flex items-center gap-2 text-lg font-semibold">
            <Sparkles className="h-4 w-4 text-navy" aria-hidden="true" /> {title}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Pick a country, an offer or a list; the creator ranks what worked and what was never
            sent, then makes a draft campaign.
          </DialogDescription>

          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted">Data period</span>
            <div className="inline-flex flex-wrap rounded-md border border-rule p-0.5">
              {CREATOR_PERIODS.map((p) => (
                <button
                  key={p}
                  type="button"
                  aria-pressed={period === p}
                  onClick={() => setPeriod(p)}
                  className={cn(
                    "rounded px-2 py-1 text-xs",
                    period === p ? "bg-navy/10 font-medium text-navy" : "text-muted hover:text-ink",
                  )}
                >
                  {CREATOR_PERIOD_LABELS[p]}
                </button>
              ))}
            </div>
          </div>
          <p className="mt-1 text-xs text-muted" data-testid="creator-period">
            {data ? `Showing data for ${data.periodLabel}` : "Loading…"}
          </p>

          <div className="mt-4 min-h-40 border-t border-rule pt-4">
            {loadError ? (
              <p className="text-sm text-signal">{loadError}</p>
            ) : !data || !model ? (
              <p className="text-sm text-muted">Loading…</p>
            ) : step === "flow" ? (
              <div className="grid gap-3 sm:grid-cols-3">
                {FLOWS.map((f) => (
                  <button
                    key={f.value}
                    type="button"
                    onClick={() => {
                      setFlow(f.value);
                      setStep("first");
                    }}
                    className="rounded-md border border-rule px-3 py-5 text-center hover:border-navy hover:bg-navy/5"
                    data-testid={`creator-flow-${f.value}`}
                  >
                    <f.icon className="mx-auto h-5 w-5 text-navy" aria-hidden="true" />
                    <span className="mt-2 block text-sm font-semibold text-ink">{f.title}</span>
                    <span className="block text-xs text-muted">{f.hint}</span>
                  </button>
                ))}
              </div>
            ) : step === "first" && flow === "country" ? (
              <>
                <SimpleSelect
                  aria-label="Country"
                  value={country}
                  placeholder="Choose a country"
                  onValueChange={(value) => {
                    setCountry(value);
                    setOfferId("");
                  }}
                  options={model.countries.map((c) => ({ value: c, label: countryName(c) }))}
                />
                {country ? (
                  <>
                    <p className="mt-3 text-sm text-ink">
                      Top offers for <strong>{countryName(country)}</strong>:
                    </p>
                    <ChoiceTable
                      head={["Offer", "ROI", "Lead → sale", "Sales"]}
                      rows={rankOffersForCountry(
                        model.inPeriod,
                        model.ever,
                        data.offers,
                        country,
                      ).map((o) => ({
                        id: o.offerId,
                        cells: [
                          <span key="name">
                            {o.offer}{" "}
                            {o.neverSent ? <Badge variant="code">Never sent</Badge> : null}
                          </span>,
                          percent(o.roi, 0),
                          percent(o.leadToSale),
                          formatNumber(o.sales),
                        ],
                      }))}
                      selected={offerId}
                      onSelect={setOfferId}
                      testId="creator-offers"
                    />
                  </>
                ) : null}
              </>
            ) : step === "first" && flow === "offer" ? (
              <>
                <SimpleSelect
                  aria-label="Offer"
                  value={offerId}
                  placeholder="Choose an offer"
                  onValueChange={(value) => {
                    setOfferId(value);
                    setCountry("");
                  }}
                  options={data.offers.map((o) => ({ value: o.id, label: o.name }))}
                />
                {offerId ? (
                  <>
                    <p className="mt-3 text-sm text-ink">
                      Top countries for <strong>{offerName}</strong>:
                    </p>
                    <ChoiceTable
                      head={["Country", "ROI", "Lead → sale", "Sales"]}
                      rows={[
                        ...rankCountriesForOffer(model.inPeriod, offerId).map((c) => ({
                          id: c.country,
                          cells: [
                            countryName(c.country),
                            percent(c.roi, 0),
                            percent(c.leadToSale),
                            formatNumber(c.sales),
                          ],
                        })),
                        ...model.countries
                          .filter(
                            (c) =>
                              !model.inPeriod.some((r) => r.offerId === offerId && r.country === c),
                          )
                          .map((c) => ({
                            id: c,
                            cells: [
                              <span key="name">
                                {countryName(c)}{" "}
                                <Badge variant="code">Not sent in this period</Badge>
                              </span>,
                              "–",
                              "–",
                              "0",
                            ],
                          })),
                      ]}
                      selected={country}
                      onSelect={setCountry}
                      testId="creator-countries"
                    />
                  </>
                ) : null}
              </>
            ) : step === "first" && flow === "list" ? (
              <ChoiceTable
                head={["List", "Country", "Last sent", "Sales"]}
                rows={[...data.lists]
                  .sort((a, b) => b.sales - a.sales || a.name.localeCompare(b.name))
                  .map((l) => ({
                    id: l.listId,
                    cells: [
                      <span key="name">
                        {l.name} {l.provider ? <Badge variant="code">{l.provider}</Badge> : null}{" "}
                        {l.lastSentAt ? null : <Badge variant="code">Never sent</Badge>}
                      </span>,
                      countryName(l.country),
                      shortDay(l.lastSentAt),
                      formatNumber(l.sales),
                    ],
                  }))}
                selected={listId}
                onSelect={(id) => {
                  setListId(id);
                  setCountry(data.lists.find((l) => l.listId === id)?.country ?? "");
                  setOfferId("");
                }}
                testId="creator-all-lists"
              />
            ) : step === "second" ? (
              <>
                <p className="text-sm text-ink">
                  Offers for <strong>{list?.name}</strong> ({countryName(country)}):
                </p>
                <ChoiceTable
                  head={["Offer", "ROI", "Lead → sale", "Sales"]}
                  rows={rankOffersForCountry(model.inPeriod, model.ever, data.offers, country).map(
                    (o) => {
                      const sentToList = model.pairsEver.some(
                        (p) => p.listId === listId && p.offerId === o.offerId && p.sent > 0,
                      );
                      return {
                        id: o.offerId,
                        cells: [
                          <span key="name">
                            {o.offer}{" "}
                            {sentToList ? null : (
                              <Badge variant="code">Never sent to this list</Badge>
                            )}
                          </span>,
                          percent(o.roi, 0),
                          percent(o.leadToSale),
                          formatNumber(o.sales),
                        ],
                      };
                    },
                  )}
                  selected={offerId}
                  onSelect={setOfferId}
                  testId="creator-offers"
                />
              </>
            ) : step === "lists" ? (
              <>
                <p className="text-sm text-ink">
                  Lists of <strong>{countryName(country)}</strong> for <strong>{offerName}</strong>:
                </p>
                <ChoiceTable
                  head={["List", "Numbers", "Last sent", "Sales"]}
                  rows={rankListsForOffer(
                    data.lists,
                    model.pairsEver,
                    model.pairsPeriod,
                    offerId,
                    country,
                  ).map((l) => ({
                    id: l.listId,
                    cells: [
                      <span key="name">
                        {l.name} {l.provider ? <Badge variant="code">{l.provider}</Badge> : null}{" "}
                        {l.neverSent ? (
                          <Badge variant="code">Never sent to {offerName}</Badge>
                        ) : null}
                      </span>,
                      formatNumber(l.numbersCount),
                      shortDay(l.lastSentAt?.toISOString() ?? null),
                      formatNumber(l.sales),
                    ],
                  }))}
                  selected={listId}
                  onSelect={setListId}
                  testId="creator-lists"
                />
              </>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-ink" data-testid="creator-summary">
                  <strong>{offerName}</strong> → <strong>{list?.name}</strong> (
                  {countryName(country)}, {formatNumber(list?.numbersCount ?? 0)} numbers)
                </p>
                <div className="space-y-1.5">
                  <span className="text-sm text-muted">Route</span>
                  {routes.length === 0 ? (
                    <p className="text-sm text-signal">
                      No route can carry {countryName(country)} yet. Add a price for it first.
                    </p>
                  ) : (
                    <SimpleSelect
                      aria-label="Route"
                      value={routeId}
                      placeholder="Choose a route"
                      onValueChange={setRouteId}
                      options={routes.map((r) => ({
                        value: r.id,
                        label: routeChoiceLabel(r, country),
                      }))}
                    />
                  )}
                </div>
                <label className="block space-y-1.5 text-sm">
                  <span className="text-muted">Planned for</span>
                  <input
                    type="date"
                    value={plannedFor}
                    onChange={(e) => setPlannedFor(e.target.value)}
                    className="block w-full rounded border border-neutral-300 px-2.5 py-1.5 text-sm"
                    data-testid="creator-day"
                  />
                </label>
                <p className="text-xs text-muted">
                  This makes a draft campaign with the list, the offer and the route. Nothing is
                  sent until you open the campaign, add the sender IDs and the text, and press Send.
                </p>
              </div>
            )}
          </div>

          {error ? <p className="mt-3 text-sm text-signal">{error}</p> : null}

          <div className="mt-5 flex items-center justify-between">
            <Button variant="outline" onClick={back} disabled={step === "flow" || pending}>
              <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back
            </Button>
            {step === "send" ? (
              <Button
                onClick={submit}
                disabled={pending || !routeId || !plannedFor}
                data-testid="creator-add"
              >
                <Check className="h-4 w-4" aria-hidden="true" />{" "}
                {pending ? "Adding…" : "Add campaign"}
              </Button>
            ) : step !== "flow" ? (
              <Button
                onClick={() => {
                  if (step === "first") setStep(flow === "list" ? "second" : "lists");
                  else if (step === "second") setStep("send");
                  else if (step === "lists") setStep("send");
                }}
                disabled={
                  step === "first"
                    ? flow === "list"
                      ? !listId
                      : !country || !offerId
                    : step === "second"
                      ? !offerId
                      : !listId
                }
                data-testid="creator-next"
              >
                Next <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Button>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** A small table whose rows are picked by clicking them. */
function ChoiceTable({
  head,
  rows,
  selected,
  onSelect,
  testId,
}: {
  head: readonly string[];
  rows: ReadonlyArray<{ id: string; cells: readonly React.ReactNode[] }>;
  selected: string;
  onSelect: (id: string) => void;
  testId: string;
}) {
  if (rows.length === 0) {
    return <p className="mt-3 text-sm text-muted">Nothing to choose from here.</p>;
  }
  return (
    <div
      className="mt-2 max-h-72 overflow-y-auto rounded-md border border-rule"
      data-testid={testId}
    >
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-neutral-50 text-xs uppercase text-muted">
          <tr>
            {head.map((h, i) => (
              <th
                key={h}
                className={cn("px-3 py-2 font-medium", i === 0 ? "text-left" : "text-right")}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              onClick={() => onSelect(row.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(row.id);
                }
              }}
              tabIndex={0}
              aria-selected={selected === row.id}
              className={cn(
                "cursor-pointer border-t border-rule",
                selected === row.id ? "bg-navy/10" : "hover:bg-neutral-50",
              )}
              data-testid="creator-choice"
              data-id={row.id}
            >
              {row.cells.map((cell, i) => (
                <td
                  // biome-ignore lint/suspicious/noArrayIndexKey: the cells of a row never reorder.
                  key={i}
                  className={cn(
                    "px-3 py-2",
                    i === 0 ? "text-left text-ink" : "text-right font-mono tabular-nums",
                  )}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
