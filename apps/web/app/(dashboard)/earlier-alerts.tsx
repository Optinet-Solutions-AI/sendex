"use client";

import { useId, useState } from "react";

export interface EarlierAlert {
  id: string;
  when: string;
  text: string;
}

/** The older alerts of one kind in the banner, folded away until asked for (D5-24). */
export function EarlierAlerts({ alerts }: { alerts: EarlierAlert[] }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  return (
    <div className="mt-1">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((v) => !v)}
        className="text-xs text-amber-800 underline underline-offset-2"
      >
        {open ? "Hide earlier" : `Show ${alerts.length} earlier`}
      </button>
      <ul
        id={listId}
        hidden={!open}
        data-testid="alert-earlier"
        className="mt-1 space-y-0.5 border-l-2 border-amber-200 pl-3 text-xs"
      >
        {alerts.map((a) => (
          <li key={a.id} className="flex flex-wrap gap-x-2">
            <span className="tabular-nums text-amber-700">{a.when}</span>
            <span>{a.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
