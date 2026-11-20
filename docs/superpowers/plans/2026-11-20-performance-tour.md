# Performance tour Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A guided tour of everything the preview features add, started once by itself and replayable from a Tour button.

**Architecture:** A client component in the dashboard shell, rendered only when `OrgContext.previewFeatures` is true. One list of steps (route, CSS target, title, text); the component navigates to each step's page, waits for the target, spotlights it and shows a card. "Seen" is kept in localStorage per organisation.

**Tech Stack:** Next.js App Router client component, React state, Tailwind tokens already in the app, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-20-performance-tour-design.md`

## Global Constraints

- No new dependency (AGENTS rule 10 spirit; the design says "built from the app's existing pieces").
- Only what New adds: the switch (when present), Performance menu, Insight, Sales Results, Trends, List Follow-Up, Create Campaign, Daily Plan and daily target, Data provider.
- Card header "{Page} · {n} of {total}"; buttons Skip, Back, Next (Finish on the last).
- localStorage key `sendex-tour-<organisation id>` = `"done"`; `sendex-tour-off` = `"1"` disables the automatic start (used by the browser tests).
- Card centred when the target is missing after 2 s.
- Card copy in plain words, no jargon.

## Review Focus

- Target never appears (empty page, role without Create Campaign): card centred, Next still works. Covered in Task 2 e2e (Emily-like org has empty pages for some steps).
- Person navigates away mid-tour with the menu: the tour follows the step's route on Next; Escape closes it. Covered by the Escape assertion in Task 2.
- Switching back to Existing mid-tour: the component unmounts; nothing breaks (layout no longer renders it). Covered implicitly; no extra test.
- Narrow screen: card stays inside the viewport (clamped position). Manual check in Task 2.
- localStorage blocked: reads and writes wrapped in try/catch; the tour then starts every time, never crashes. Unit test in Task 1.

---

### Task 1: Steps and storage

**Files:**
- Create: `apps/web/components/tour/steps.ts`, `apps/web/components/tour/steps.test.ts`

**Interfaces:**
- Produces: `interface TourStep { id: string; page: string; route: string | null; target: string | null; title: string; body: string; switchOnly?: boolean }`, `stepsFor(o: { hasSwitch: boolean }): TourStep[]`, `tourKey(organisationId: string): string`, `tourSeen(storage: Pick<Storage, "getItem"> | null, organisationId: string): boolean`, `markTourSeen(storage: Pick<Storage, "setItem"> | null, organisationId: string): void`, `autoStartAllowed(storage: Pick<Storage, "getItem"> | null): boolean`.

- [ ] Write failing tests: `stepsFor({hasSwitch:true})` contains id `switch`, `stepsFor({hasSwitch:false})` does not; ids unique; the routes of steps with a route appear in the order `/kpi/insight`, `/kpi/sales-results`, `/kpi/trends`, `/kpi/list-follow-up`, `/kpi/daily-plan`, `/lists`; every step except `welcome` and `done` has a target; `tourSeen` false then true after `markTourSeen`; a storage whose `getItem` throws gives `tourSeen` false and `autoStartAllowed` true; `autoStartAllowed` false when `sendex-tour-off` is `"1"`.
- [ ] Run `pnpm --filter @sendex/web exec vitest run components/tour/steps.test.ts`: FAIL (module missing).
- [ ] Implement `steps.ts` with the step list (welcome, switch, menu, insight-period, insight-totals, insight-by-country, sales-results, trends-figures, trends-breakdown, follow-up-table, follow-up-filters, follow-up-untouched, create-campaign, daily-plan, data-provider, done). Targets: `[data-testid="view-toggle"]`, `[data-tour-group="Performance"]`, `[data-testid="insight-filters"]`, `[aria-label="Totals"]`, `[data-testid="insight-by-country"]`, `[data-testid="sales-results-table"]`, `[data-testid="trends-filters"]`, `[data-testid="trends-breakdown"]`, `[data-testid="follow-up-table"]`, `[data-testid="follow-up-filters"]`, `[data-testid="follow-up-untouched"]`, `[data-testid="open-campaign-creator"]`, `[aria-label="The day"]`, `[data-testid="tour-button"]` for data-provider? no: data-provider has route `/lists` and target `[data-testid="lists-table"]`-like element found at implementation; done targets `[data-testid="tour-button"]`.
- [ ] Run the test: PASS. Commit.

### Task 2: Tour component, Tour button, shell wiring, browser test, docs

**Files:**
- Create: `apps/web/components/tour/performance-tour.tsx`, `apps/web/e2e/performance-tour.spec.ts`
- Modify: `apps/web/app/(dashboard)/layout.tsx` (render `<PerformanceTour organisationId hasSwitch />` when `shell.previewFeatures`), `apps/web/components/shell/rail.tsx` (`data-tour-group={group.label}` on each group `li`), `apps/web/playwright.config.ts` (`use.storageState` with origin `baseURL` localStorage `sendex-tour-off=1`), `docs/src/content/docs/using/performance.md`, `docs/engineering/kpi.md`

**Interfaces:**
- Consumes: Task 1 exports.
- Produces: `PerformanceTour({ organisationId: string; hasSwitch: boolean })` rendering the Tour button (`data-testid="tour-button"`) and, while running, the card (`role="dialog"`, `aria-label="Performance tour"`, `data-testid="tour-card"`) and spotlight.

- [ ] Write the failing e2e `performance-tour.spec.ts` (with `test.use({ storageState: { cookies: [], origins: [] } })`): demo org preview off + toggle on; on `/` click New → card "1 of" visible with "Welcome"; click Next until Finish, asserting the URL reaches `/kpi/insight`, `/kpi/trends`, `/kpi/daily-plan` on the way; Finish closes it; reload: no card; Tour button reopens it; Escape closes it. Second test: preview on, toggle off → Tour button visible and the card opens by itself on `/`.
- [ ] Run it: FAIL (no Tour button).
- [ ] Implement the component: state `index: number | null`; on mount, if `autoStartAllowed` and not `tourSeen`, start at 0; on index change `router.push(step.route)` when the path differs, then poll every 100 ms up to 2 s for `document.querySelector(step.target)`, `scrollIntoView({block:"center"})`, measure, draw a fixed spotlight (`box-shadow: 0 0 0 9999px rgba(15,23,42,.55)`) around it and place the card below it, above when there is no room, clamped to the viewport; no target → centred card; Escape, Skip and Finish call `markTourSeen` and close; re-measure on resize and scroll.
- [ ] Wire layout, rail marker, Playwright storage state; run the new spec and `preview-toggle`, `preview-switch`: PASS.
- [ ] Docs: how-to paragraph "Tour"; engineering section "Performance tour (D5-12)".
- [ ] `pnpm --filter @sendex/web exec vitest run`, typecheck, Biome; commit; open the PR.
