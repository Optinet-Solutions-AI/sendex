"use client";

import { Badge } from "@sendex/ui";
import { useState, useTransition } from "react";
import { setOfferDealAction } from "./actions";

export interface OfferDealView {
  id: string;
  name: string;
  url: string;
  dealKey: string | null;
  /** A deal whose brand is in the offer's name, for an offer without one. */
  suggestion: string | null;
}

/** One row per offer with a choice of brand deal; a choice saves at once. */
export function OfferDeals({
  offers,
  options,
  canManage,
}: {
  offers: OfferDealView[];
  options: { key: string; label: string; brand: string }[];
  canManage: boolean;
}) {
  const [chosen, setChosen] = useState<Record<string, string>>(() =>
    Object.fromEntries(offers.map((o) => [o.id, o.dealKey ?? ""])),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const known = new Set(options.map((o) => o.key));

  function choose(linkId: string, key: string) {
    const before = chosen[linkId] ?? "";
    setChosen((c) => ({ ...c, [linkId]: key }));
    setError(null);
    start(async () => {
      const result = await setOfferDealAction({ linkId, dealKey: key === "" ? null : key });
      if (!result.ok) {
        setError(result.error);
        setChosen((c) => ({ ...c, [linkId]: before }));
      }
    });
  }

  return (
    <div>
      <ul className="divide-y divide-rule" data-testid="offer-deals">
        {offers.map((offer) => {
          const value = chosen[offer.id] ?? "";
          const suggested =
            value === "" && offer.suggestion
              ? options.find((o) => o.key === offer.suggestion)
              : undefined;
          return (
            <li key={offer.id} className="flex flex-wrap items-center gap-3 px-4 py-2">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-ink">{offer.name}</div>
                <div className="truncate font-mono text-xs text-muted">{offer.url}</div>
              </div>
              <div className="flex flex-col items-end gap-1">
                <select
                  aria-label={`Deal for ${offer.name}`}
                  className="h-9 max-w-xs rounded-md border border-rule bg-surface px-2 text-sm"
                  value={value}
                  disabled={!canManage || pending}
                  onChange={(e) => choose(offer.id, e.target.value)}
                >
                  <option value="">No deal: earns nothing</option>
                  {value !== "" && !known.has(value) ? (
                    <option value={value}>{value} (no longer uploaded)</option>
                  ) : null}
                  {options.map((o) => (
                    <option key={o.key} value={o.key}>
                      {o.label}
                    </option>
                  ))}
                </select>
                {suggested && canManage ? (
                  <button
                    type="button"
                    className="text-xs text-navy underline"
                    disabled={pending}
                    onClick={() => choose(offer.id, suggested.key)}
                  >
                    Use {suggested.brand}?
                  </button>
                ) : null}
                {value === "" ? <Badge variant="amber">No revenue</Badge> : null}
              </div>
            </li>
          );
        })}
      </ul>
      {error ? (
        <p role="alert" className="px-4 pb-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
