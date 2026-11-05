"use client";

import { formatPricePerSms } from "./format";
import type { RouteView } from "./types";
import { Panel } from "./ui";

/** Multi-select of the routes usable for the campaign country with the price per SMS. */
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
    <Panel title="Routes" testId="routes-panel">
      {routes.length === 0 ? (
        <p className="text-xs text-neutral-500">No routes are priced for this country yet.</p>
      ) : (
        <ul className="divide-y divide-neutral-100">
          {routes.map((route) => (
            <li key={route.id} className="flex items-center justify-between py-1.5">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={picked.has(route.id)}
                  disabled={route.priceMicro === null}
                  onChange={(e) => toggle(route.id, e.target.checked)}
                  data-testid={`route-${route.name}`}
                />
                <span className="font-medium">{route.name}</span>
                <span className="text-xs text-neutral-500">
                  {route.platform ? "platform" : route.provider}
                </span>
              </label>
              <span className="text-xs text-neutral-600">
                {formatPricePerSms(route.priceMicro)}
                {route.priceMicro !== null ? " / SMS" : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
