/**
 * The Performance tour (D5-12): one step per thing the preview features add, in the order the
 * tour walks them. A step names the page it is on (`route`, null for "wherever you are") and
 * the element it points at (`target`, a CSS selector of a marker that already exists on that
 * page). When a page changes, this list is the one place to update.
 */
export interface TourStep {
  id: string;
  /** Shown in the card header, before "n of total". */
  page: string;
  route: string | null;
  target: string | null;
  title: string;
  body: string;
  /** Only for an organisation with the Existing / New switch (D5-11). */
  switchOnly?: boolean;
}

const STEPS: readonly TourStep[] = [
  {
    id: "welcome",
    page: "Welcome",
    route: null,
    target: null,
    title: "Business KPI: what's new",
    body: "Sendex now has a Performance section: pages that show which offers, countries and lists bring sales, how this month compares with the last, and what to send next. This tour shows you each one in about two minutes. Everything else in Sendex works as before.",
  },
  {
    id: "switch",
    page: "Existing / New",
    route: null,
    target: '[data-testid="view-toggle"]',
    title: "The Existing / New switch",
    body: "New shows the Performance pages; Existing hides them again and Sendex looks as it did before. Only your own view changes, and you can switch any time.",
    switchOnly: true,
  },
  {
    id: "menu",
    page: "Menu",
    route: null,
    target: '[data-tour-group="Performance"]',
    title: "The Performance menu",
    body: "All the new pages are here in the side menu: Insight, Sales Results, Trends, List Follow-Up and Daily Plan. Let's open them one by one.",
  },
  {
    id: "insight-period",
    page: "Insight",
    route: "/kpi/insight",
    target: '[data-testid="insight-filters"]',
    title: "Insight: pick a period",
    body: "Insight reviews a period: the current month to start with, or another month, a whole year or all time. Everything on the page follows this choice.",
  },
  {
    id: "insight-totals",
    page: "Insight",
    route: "/kpi/insight",
    target: '[aria-label="Totals"]',
    title: "Totals and per sale",
    body: "Sales (first deposits), revenue, cost and net profit for the period. Below them, what one sale cost and brought in, and SMS per sale: how many SMS it took to get one sale. Fewer is better.",
  },
  {
    id: "insight-by-country",
    page: "Insight",
    route: "/kpi/insight",
    target: '[data-testid="insight-by-country"]',
    title: "Offer performance by country",
    body: "Each country opens to its best offers, ranked by ROI or by sales, with sent, leads, sales, cost and revenue. The bars above show the top offers by ROI and the countries that sell; a red bar is a loss.",
  },
  {
    id: "sales-results",
    page: "Sales Results",
    route: "/kpi/sales-results",
    target: '[data-testid="sales-results-table"]',
    title: "Sales Results: the daily record",
    body: "One line per day, offer, route, country and list, with the list's data provider, its leads, sales and revenue. Nobody types it in: it comes from the brand's postbacks. Click Date, Leads, Sales or Revenue to sort.",
  },
  {
    id: "trends-figures",
    page: "Trends",
    route: "/kpi/trends",
    target: '[data-testid="trends-filters"]',
    title: "Trends: this month against the last",
    body: "Leads, sales and lead → sale for the month so far, against the same days of the month before. Choose Daily or Cumulative for the two charts; the dotted line is the month before.",
  },
  {
    id: "trends-breakdown",
    page: "Trends",
    route: "/kpi/trends",
    target: '[data-testid="trends-breakdown"]',
    title: "Breakdown",
    body: "The month per route, offer, country or data provider (the Group by choice above), with an arrow saying whether the second half of the month converts better or worse than the first.",
  },
  {
    id: "follow-up-table",
    page: "List Follow-Up",
    route: "/kpi/list-follow-up",
    target: '[data-testid="follow-up-table"]',
    title: "List Follow-Up: what each list brought",
    body: "One row per country, best ROI first. Open a country with the arrow to see each list with what it sent, its leads, sales, cost, revenue, ROI and its data provider.",
  },
  {
    id: "follow-up-filters",
    page: "List Follow-Up",
    route: "/kpi/list-follow-up",
    target: '[data-testid="follow-up-filters"]',
    title: "Filters",
    body: "Search a list by name, or narrow to one route, one offer, some countries or a date range. Pick an offer and the card below lists the lists that have never been sent that offer.",
  },
  {
    id: "follow-up-untouched",
    page: "List Follow-Up",
    route: "/kpi/list-follow-up",
    target: '[data-testid="follow-up-untouched"]',
    title: "Not sent yet",
    body: "Every list with no SMS in the filters you picked: fresh lists you can still use, with their country, data provider and size.",
  },
  {
    id: "create-campaign",
    page: "List Follow-Up",
    route: "/kpi/list-follow-up",
    target: '[data-testid="open-campaign-creator"]',
    title: "Create Campaign",
    body: "Helps you choose what to send next. Go in by country, by offer or by list, see what worked best, and lists never sent to that offer are marked. It makes a draft campaign with the list, the offer's link and the route: nothing is sent. Add sender IDs and the text in Campaigns and send as usual.",
  },
  {
    id: "daily-plan",
    page: "Daily Plan",
    route: "/kpi/daily-plan",
    target: '[aria-label="The day"]',
    title: "Daily Plan",
    body: "The campaigns planned for a day (the day you set in Create Campaign), with their contacts against your daily target. Use the arrows to move between days. The daily target is a goal to plan against; it never blocks a send.",
  },
  {
    id: "data-provider",
    page: "Lists",
    route: "/lists",
    target: 'a[href="/lists/upload"]',
    title: "Data provider on lists",
    body: "When you upload a new list you can now say who supplied it (for example ZEN or DER). It shows on the list's page, where you can change it, and the Performance pages can group and filter by it.",
  },
  {
    id: "done",
    page: "Done",
    route: null,
    target: '[data-testid="tour-button"]',
    title: "That's the tour",
    body: "Open it again any time with this Tour button. Your numbers fill these pages as your campaigns send and the brands report registrations and deposits.",
  },
];

export function stepsFor(options: { hasSwitch: boolean }): TourStep[] {
  return STEPS.filter((step) => options.hasSwitch || !step.switchOnly);
}

/** localStorage key that remembers the tour was finished or skipped, per organisation. */
export function tourKey(organisationId: string): string {
  return `sendex-tour-${organisationId}`;
}

/** Set to "1" to stop the automatic start in this browser (the browser tests do). */
const AUTO_START_OFF = "sendex-tour-off";

export function tourSeen(
  storage: Pick<Storage, "getItem"> | null,
  organisationId: string,
): boolean {
  try {
    return storage?.getItem(tourKey(organisationId)) === "done";
  } catch {
    return false;
  }
}

export function markTourSeen(
  storage: Pick<Storage, "setItem"> | null,
  organisationId: string,
): void {
  try {
    storage?.setItem(tourKey(organisationId), "done");
  } catch {
    // Storage blocked: the tour simply starts again next time.
  }
}

export function autoStartAllowed(storage: Pick<Storage, "getItem"> | null): boolean {
  try {
    return storage?.getItem(AUTO_START_OFF) !== "1";
  } catch {
    return true;
  }
}
