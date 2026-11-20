"use client";

import { Compass } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { autoStartAllowed, markTourSeen, stepsFor, tourSeen } from "./steps";

/** How long a step waits for its element before showing the card in the middle. */
const WAIT_MS = 2000;
const POLL_MS = 100;
/** Space around the highlighted element, and between it and the card. */
const PAD = 6;
const GAP = 12;
const EDGE = 16;
const CARD_WIDTH = 360;

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * The Performance tour (D5-12): a Tour button in the top bar and, while running, a card that
 * walks every preview feature page by page and highlights the element it talks about. It
 * starts by itself the first time the preview features are shown in this browser for this
 * organisation, and is remembered as seen once finished, skipped or closed. It only navigates
 * and points: nothing is read from or written to the server.
 */
export function PerformanceTour({
  organisationId,
  hasSwitch,
}: {
  organisationId: string;
  hasSwitch: boolean;
}) {
  const steps = useMemo(() => stepsFor({ hasSwitch }), [hasSwitch]);
  const router = useRouter();
  const pathname = usePathname();
  const [index, setIndex] = useState<number | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [cardHeight, setCardHeight] = useState(220);
  const [viewport, setViewport] = useState({ width: 1280, height: 800 });
  const cardRef = useRef<HTMLDivElement>(null);
  const step = index === null ? null : steps[index];
  /** A step on another page waits, hidden, until that page has opened. */
  const onPage = step !== null && step !== undefined && (!step.route || pathname === step.route);

  useEffect(() => {
    const s = storage();
    if (autoStartAllowed(s) && !tourSeen(s, organisationId)) setIndex(0);
  }, [organisationId]);

  const close = useCallback(() => {
    markTourSeen(storage(), organisationId);
    setIndex(null);
    setBox(null);
  }, [organisationId]);

  // Go to the step's page, then wait for its element and measure it.
  useEffect(() => {
    if (!step) return;
    setBox(null);
    if (step.route && pathname !== step.route) {
      router.push(step.route);
      return;
    }
    if (!step.target) return;
    const selector = step.target;
    let element: Element | null = null;
    const measure = () => {
      if (!element) return;
      const r = element.getBoundingClientRect();
      setBox({ top: r.top, left: r.left, width: r.width, height: r.height });
    };
    const started = Date.now();
    const poll = window.setInterval(() => {
      element = document.querySelector(selector);
      if (element) {
        window.clearInterval(poll);
        element.scrollIntoView({ block: "center", behavior: "instant" as ScrollBehavior });
        measure();
      } else if (Date.now() - started > WAIT_MS) {
        window.clearInterval(poll);
      }
    }, POLL_MS);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.clearInterval(poll);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [step, pathname, router]);

  useEffect(() => {
    if (index === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    const onResize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    onResize();
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
    };
  }, [index, close]);

  useLayoutEffect(() => {
    if (cardRef.current) setCardHeight(cardRef.current.offsetHeight);
    cardRef.current?.focus();
  });

  const last = index !== null && index === steps.length - 1;
  const width = Math.min(CARD_WIDTH, viewport.width - 2 * EDGE);

  let cardStyle: React.CSSProperties = {
    width,
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
  };
  if (box) {
    const below = box.top + box.height + PAD + GAP;
    const above = box.top - PAD - GAP - cardHeight;
    const top =
      below + cardHeight <= viewport.height - EDGE
        ? below
        : above >= EDGE
          ? above
          : Math.max(EDGE, viewport.height - EDGE - cardHeight);
    const left = Math.min(Math.max(box.left, EDGE), viewport.width - EDGE - width);
    cardStyle = { width, top, left };
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setIndex(0)}
        data-testid="tour-button"
        className="flex items-center gap-1.5 rounded-md border border-rule bg-page px-2.5 py-1 text-sm font-medium text-muted hover:bg-neutral-100 hover:text-ink"
      >
        <Compass className="h-4 w-4" aria-hidden="true" />
        Tour
      </button>
      {step && onPage ? (
        <>
          {/* Holds clicks while the tour runs, and darkens the page around the element. */}
          <div className="fixed inset-0 z-[60]" aria-hidden="true">
            {box ? (
              <div
                className="pointer-events-none absolute rounded-lg ring-2 ring-white transition-all"
                style={{
                  top: box.top - PAD,
                  left: box.left - PAD,
                  width: box.width + 2 * PAD,
                  height: box.height + 2 * PAD,
                  boxShadow: "0 0 0 9999px rgba(15, 23, 42, 0.55)",
                }}
              />
            ) : (
              <div className="absolute inset-0 bg-slate-900/55" />
            )}
          </div>
          <div
            ref={cardRef}
            role="dialog"
            aria-label="Performance tour"
            aria-live="polite"
            tabIndex={-1}
            data-testid="tour-card"
            className="fixed z-[61] rounded-lg border border-rule bg-surface p-4 shadow-xl outline-none"
            style={cardStyle}
          >
            <div className="text-xs font-medium uppercase tracking-wide text-muted">
              {step.page} · {(index ?? 0) + 1} of {steps.length}
            </div>
            <h2 className="mt-1 text-base font-semibold text-ink">{step.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-ink">{step.body}</p>
            <div className="mt-4 flex items-center gap-2">
              <button
                type="button"
                onClick={close}
                className="mr-auto rounded-md px-2 py-1 text-sm text-muted hover:text-ink"
              >
                Skip
              </button>
              <button
                type="button"
                disabled={index === 0}
                onClick={() => setIndex((i) => (i === null ? i : Math.max(0, i - 1)))}
                className="rounded-md border border-rule px-3 py-1 text-sm text-ink hover:bg-neutral-100 disabled:opacity-40"
              >
                Back
              </button>
              <button
                type="button"
                onClick={() => (last ? close() : setIndex((i) => (i === null ? i : i + 1)))}
                className="rounded-md bg-navy px-3 py-1 text-sm font-medium text-white hover:opacity-90"
              >
                {last ? "Finish" : "Next"}
              </button>
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}
