"use client";

import { Badge, EmptyState } from "@sendex/ui";
import { Radio } from "lucide-react";
import { formatPricePerSms } from "./format";
import type { RouteView } from "./types";

/**
 * The Routes context tab: a checkbox row per route priced for the campaign country, with
 * the name, a SMART tag for smart routes and the price per SMS ("Route 405 €0.025").
 * Route performance (platform ranks, account statistics) arrives with the next card.
 */
export function RoutesPanel({
  routes,
  selected,
  onChange,
}: {
  routes: RouteView[];
  selected: readonly string[];
  onChange: (routeIds: string[]) => void;
}) {
  const picked = new Set(selected);
  function toggle(id: string, checked: boolean) {
    const next = new Set(picked);
    if (checked) next.add(id);
    else next.delete(id);
    onChange(routes.filter((r) => next.has(r.id)).map((r) => r.id));
  }
  return (
    <div className="space-y-3" data-testid="routes-panel">
      <h4 className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted">Routes</h4>
      {routes.length === 0 ? (
        <EmptyState
          icon={<Radio />}
          title="No routes for this country"
          hint="No route is priced for this country yet."
        />
      ) : (
        <ul className="divide-y divide-rule rounded-md border border-rule bg-surface">
          {routes.map((route) => (
            <li key={route.id}>
              <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-neutral-50">
                <input
                  type="checkbox"
                  checked={picked.has(route.id)}
                  disabled={route.priceMicro === null}
                  onChange={(e) => toggle(route.id, e.target.checked)}
                  data-testid={`route-${route.name}`}
                />
                <span className="font-medium text-ink">
                  {route.platform ? `Route ${route.name}` : route.name}
                </span>
                {!route.platform ? <Badge variant="code">{route.provider}</Badge> : null}
                <span className="ml-auto font-mono text-xs text-muted">
                  {route.priceMicro === null ? "No pricing" : formatPricePerSms(route.priceMicro)}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
