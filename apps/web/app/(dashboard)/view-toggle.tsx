"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { PreviewView } from "../../lib/preview";
import { setPreviewViewAction } from "./preview-actions";

const CHOICES: ReadonlyArray<{ view: PreviewView; label: string }> = [
  { view: "existing", label: "Existing" },
  { view: "new", label: "New" },
];

/**
 * The Existing / New switch of the top bar (D5-11), shown only to an organisation that is
 * offered it. New adds the Performance screens and the list data provider; Existing is the app
 * as it was. Leaving New while on a Performance page goes to the home page, which still exists.
 * It sits in the top bar, outside the page's toast provider, so a refusal is shown next to it.
 */
export function ViewToggle({ view }: { view: PreviewView }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function choose(next: PreviewView) {
    if (next === view || pending) return;
    startTransition(async () => {
      const result = await setPreviewViewAction(next);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setError(null);
      if (next === "existing" && pathname.startsWith("/kpi")) router.push("/");
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2">
      <fieldset
        className="flex items-center rounded-md border border-rule bg-page p-0.5 text-sm"
        data-testid="view-toggle"
        aria-busy={pending}
      >
        <legend className="sr-only">App version</legend>
        {CHOICES.map((choice) => {
          const active = choice.view === view;
          return (
            <button
              key={choice.view}
              type="button"
              aria-pressed={active}
              disabled={pending}
              onClick={() => choose(choice.view)}
              className={`rounded px-3 py-1 font-medium transition-colors ${
                active ? "bg-navy text-white" : "text-muted hover:bg-neutral-100 hover:text-ink"
              }`}
            >
              {choice.label}
            </button>
          );
        })}
      </fieldset>
      {error ? (
        <span role="alert" className="text-xs text-red-700">
          {error}
        </span>
      ) : null}
    </div>
  );
}
