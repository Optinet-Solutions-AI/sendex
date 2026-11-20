# Performance tour (D5-12)

Date: 20 November 2026. Approved by Christian in chat the same day.

## Why

Emily has used Sendex for a week. When she switches the top bar to **New** (D5-11), the
Performance pages and the list data provider appear. Christian wants her to understand them
without being walked through by hand: a guided tour inside the app. Hannah Porter's account
(Hannah's Organization, Performance always on, no switch) gets the same tour for demos.

## Approaches considered

- **Guided tour on the real pages** (picked): steps that move page by page and point at the
  actual tiles, filters and buttons. Closest to someone sitting next to her; the step targets
  must be kept in step with the pages.
- A "How to use Performance" guide page inside Sendex: simpler and sturdier, but read rather
  than shown.
- A document sent to her: no app change, but not in the accounts.

## Design

- **Scope: only what New adds.** The switch (when the organisation has one), the Performance
  menu, Insight, Sales Results, Trends, List Follow-Up and its filters, Create Campaign (draft
  only, nothing sent), Daily Plan with the daily target, and the Data provider on lists (list
  page, upload form). About fifteen steps.
- **Shape.** A welcome card, then steps that highlight a real element and show a small card
  beside it ("Insight · 3 of 15", title, one or two sentences, Skip / Back / Next). Next moves
  to the next page by itself. A closing card says how to replay and, with a switch, how to go
  back to Existing. Escape closes it.
- **Missing target.** If the element a step points at is not on the page (an empty page, a
  role without the button), the card is shown centred and still explains what will be there.
- **When it starts.** Automatically the first time the preview features are shown in this
  browser for this organisation: for Emily, the first switch to New; for Hannah's
  Organization, the first visit while signed in. Remembered per organisation in the browser
  (localStorage, `sendex-tour-<organisation id>`). A **Tour** button in the top bar, shown
  whenever the preview features are on, replays it.
- **Built from** the app's existing pieces (no new library). Steps live in one list (route,
  target `data-tour` name, title, text), so a page change means editing one place.

## Calls made while designing

- Remembered per browser, not per person on the server: a second browser shows the tour once
  more, which is harmless and avoids a database change.
- The tour reads nothing and writes nothing on the server; it only navigates and points.

## Tests and docs

Playwright: starts by itself on the first switch to New and not again; walks every page with
Next; Skip ends it; the Tour button replays it; an organisation with Performance always on gets
the Tour button. Unit tests for the step list (every step names a page and a target, pages in
menu order). The Performance how-to gains a "Tour" paragraph; `docs/engineering/kpi.md` a
section.
