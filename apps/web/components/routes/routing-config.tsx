"use client";

import {
  countryName,
  flagEmoji,
  ROUTING_STRATEGIES,
  ROUTING_STRATEGY_COPY,
  type RoutingStrategy,
} from "@sendex/core";
import { Badge, Button, Card, CardHeader, Tooltip, useToast } from "@sendex/ui";
import { Globe, Info, Settings2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  deleteRoutingExceptionAction,
  setRoutingStrategyAction,
  upsertRoutingExceptionAction,
} from "../../app/(dashboard)/routes/actions";
import { ErrorText, inputClass } from "../campaigns/ui";

export interface RoutingConfigView {
  strategy: RoutingStrategy;
  exceptions: Array<{
    country: string;
    routeOrder: string[];
    disabledRoutes: string[];
    lockedRoute: string | null;
  }>;
  /** Countries with a priced custom route. */
  countries: string[];
  /** Every route (custom and platform) by id, for the exception editor. */
  routes: Array<{ id: string; name: string; platform: boolean }>;
}

/** Routing Configuration: the default strategy radio cards and the per-country exceptions. */
export function RoutingConfig({
  config,
  canManage,
}: {
  config: RoutingConfigView;
  canManage: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const [country, setCountry] = useState("");
  const [locked, setLocked] = useState("");
  const [disabled, setDisabled] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const routeName = (id: string) => {
    const r = config.routes.find((x) => x.id === id);
    return r ? (r.platform ? `Route ${r.name}` : r.name) : "deleted route";
  };

  const choose = (strategy: RoutingStrategy) =>
    start(async () => {
      const result = await setRoutingStrategyAction(strategy);
      if (!result.ok) toast({ title: result.error, variant: "error" });
      else router.refresh();
    });

  const addException = () => {
    setError(null);
    start(async () => {
      const result = await upsertRoutingExceptionAction({
        country,
        routeOrder: [],
        disabledRoutes: disabled,
        lockedRoute: locked || null,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setCountry("");
      setLocked("");
      setDisabled([]);
      router.refresh();
    });
  };

  return (
    <div className="space-y-4" data-testid="routing-config">
      <Card>
        <CardHeader
          title={
            <span className="inline-flex items-center gap-2">
              <Settings2 className="h-4 w-4 text-muted" aria-hidden="true" /> Default routing
              strategy
              <Tooltip content="Applies to all countries unless you add a per-country exception below">
                <Info className="h-3.5 w-3.5 text-muted" aria-label="About the default strategy" />
              </Tooltip>
            </span>
          }
        />
        <div className="grid gap-3 p-4 md:grid-cols-3">
          {ROUTING_STRATEGIES.map((s) => {
            const active = config.strategy === s;
            return (
              <button
                key={s}
                type="button"
                disabled={!canManage || pending}
                onClick={() => choose(s)}
                aria-pressed={active}
                className={`rounded-lg border p-4 text-left transition-colors ${active ? "border-navy bg-navy-soft" : "border-rule hover:bg-neutral-50"}`}
                data-testid={`strategy-${s}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-ink">
                    {ROUTING_STRATEGY_COPY[s].label}
                  </span>
                  {active ? <Badge variant="active">Active</Badge> : null}
                </div>
                <p className="mt-1 text-xs text-muted">{ROUTING_STRATEGY_COPY[s].text}</p>
              </button>
            );
          })}
        </div>
      </Card>

      <Card>
        <CardHeader
          title={
            <span className="inline-flex items-center gap-2">
              <Globe className="h-4 w-4 text-muted" aria-hidden="true" /> Per-country exceptions
              <Tooltip content="Exceptions to the default strategy — set route order, disable routes, or lock a specific route per country">
                <Info className="h-3.5 w-3.5 text-muted" aria-label="About exceptions" />
              </Tooltip>
            </span>
          }
        />
        <div className="space-y-3 p-4">
          {config.countries.length === 0 ? (
            <p className="text-sm text-muted" data-testid="exceptions-empty">
              No countries with custom routes. Add pricing to your routes first.
            </p>
          ) : (
            <>
              {config.exceptions.length > 0 ? (
                <ul className="divide-y divide-rule rounded-md border border-rule">
                  {config.exceptions.map((e) => (
                    <li
                      key={e.country}
                      className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm"
                      data-testid="exception-row"
                    >
                      <span className="font-medium">
                        <span aria-hidden="true">{flagEmoji(e.country)}</span>{" "}
                        {countryName(e.country)}
                      </span>
                      {e.lockedRoute ? (
                        <Badge variant="code">locked: {routeName(e.lockedRoute)}</Badge>
                      ) : null}
                      {e.disabledRoutes.length > 0 ? (
                        <span className="text-muted">
                          off: {e.disabledRoutes.map(routeName).join(", ")}
                        </span>
                      ) : null}
                      {canManage ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="ml-auto"
                          onClick={() =>
                            start(async () => {
                              await deleteRoutingExceptionAction({ country: e.country });
                              router.refresh();
                            })
                          }
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Remove
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
              {canManage ? (
                <div className="flex flex-wrap items-end gap-2" data-testid="exception-form">
                  <label className="block text-sm">
                    <span className="text-muted">Country</span>
                    <select
                      className={inputClass}
                      value={country}
                      onChange={(e) => setCountry(e.target.value)}
                      data-testid="exception-country"
                    >
                      <option value="">Pick…</option>
                      {config.countries.map((c) => (
                        <option key={c} value={c}>
                          {countryName(c)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-sm">
                    <span className="text-muted">Lock to route</span>
                    <select
                      className={inputClass}
                      value={locked}
                      onChange={(e) => setLocked(e.target.value)}
                      data-testid="exception-locked"
                    >
                      <option value="">No lock</option>
                      {config.routes.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.platform ? `Route ${r.name}` : r.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <fieldset className="text-sm">
                    <legend className="text-muted">Disable</legend>
                    <div className="flex flex-wrap gap-2">
                      {config.routes.map((r) => (
                        <label key={r.id} className="inline-flex items-center gap-1">
                          <input
                            type="checkbox"
                            checked={disabled.includes(r.id)}
                            onChange={(e) =>
                              setDisabled((d) =>
                                e.target.checked ? [...d, r.id] : d.filter((x) => x !== r.id),
                              )
                            }
                          />
                          {r.platform ? `Route ${r.name}` : r.name}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <Button
                    onClick={addException}
                    disabled={!country || pending}
                    data-testid="exception-save"
                  >
                    Save exception
                  </Button>
                  <ErrorText error={error} />
                </div>
              ) : null}
            </>
          )}
        </div>
      </Card>
    </div>
  );
}
