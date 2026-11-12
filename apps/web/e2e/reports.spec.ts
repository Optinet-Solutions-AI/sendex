import { expect, test } from "@playwright/test";
import { cleanupE2eResults, type SeededResults, seedE2eResults } from "./helpers/db";

const PREFIX = "E2E Reports";

/**
 * The Campaigns Log and the Send Calendar (D4-05) over the seeded results campaign: eleven
 * messages on 14 Sep 2026, nine of them accepted by the carrier (five on route 405, four on
 * 403), three of which were clicked.
 */
test.describe("reports", () => {
  test.describe.configure({ mode: "serial" });
  let seeded: SeededResults;

  test.beforeAll(async () => {
    await cleanupE2eResults(PREFIX);
    seeded = await seedE2eResults(PREFIX);
  });

  test.afterAll(async () => {
    await cleanupE2eResults(PREFIX);
  });

  test("the Campaigns Log has a row per route with the day's sends and clicks", async ({
    page,
  }) => {
    await page.goto("/reports/campaigns-log?period=custom&from=2026-09-14&to=2026-09-14");
    await expect(page.getByRole("heading", { level: 1, name: "Campaigns Log" })).toBeVisible();

    const rows = page.getByTestId("log-row").filter({ hasText: seeded.campaignName });
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText("Sep 14, 2026");
    await expect(rows.nth(0)).toContainText("405");
    await expect(rows.nth(0).getByTestId("log-sent")).toHaveText("5");
    await expect(rows.nth(0)).toContainText("40.00%");
    await expect(rows.nth(1)).toContainText("403");
    await expect(rows.nth(1).getByTestId("log-sent")).toHaveText("4");
    await expect(rows.nth(1)).toContainText("25.00%");
    // No ledger debits were seeded: two clicks on no spend is €0.0000.
    await expect(rows.nth(0).getByTestId("log-cpc")).toHaveText("€0.0000");

    // The KPI strip covers at least this campaign.
    const sent = Number(
      ((await page.getByTestId("kpi-sent").textContent()) ?? "").replace(/,/g, ""),
    );
    expect(sent).toBeGreaterThanOrEqual(9);
    // D4-12: sales count on the day the deposit was made; late ones have their own total.
    await expect(page.getByTestId("kpi-late-sales")).toBeVisible();

    // Another country filter hides it; the CSV export carries the same filters.
    await page.goto(
      "/reports/campaigns-log?period=custom&from=2026-09-14&to=2026-09-14&country=GB",
    );
    await expect(page.getByTestId("log-row").filter({ hasText: seeded.campaignName })).toHaveCount(
      0,
    );
    const csv = await page.request.get(
      "/reports/campaigns-log/export?period=custom&from=2026-09-14&to=2026-09-14&country=ES",
    );
    expect(csv.ok()).toBe(true);
    expect(csv.headers()["content-type"]).toContain("text/csv");
    const body = await csv.text();
    expect(body).toContain("Date,Campaign,Country,List,Route,Sent");
    expect(body).toContain("Leads,Sales,Late sales");
    expect(body).toContain(`2026-09-14,${seeded.campaignName},ES,`);
  });

  test("the Send Calendar shows the day, its country line and the day modal", async ({ page }) => {
    await page.goto("/campaigns/scheduled?month=2026-09");
    await expect(page.getByRole("heading", { level: 1, name: "Send Calendar" })).toBeVisible();
    await expect(page.getByTestId("calendar-title")).toHaveText("September 2026");

    const day = page.locator('[data-testid="calendar-day"][data-day="2026-09-14"]');
    await expect(day).toBeVisible();
    const sentOnDay = Number(await day.getAttribute("data-sent"));
    expect(sentOnDay).toBeGreaterThanOrEqual(9);
    const line = day.getByTestId("calendar-country-line").filter({ hasText: "Spain" });
    await expect(line).toBeVisible();

    // The modal lists the campaign with its sends, clicks and CTR, and a TOTAL row.
    await expect(async () => {
      await line.click();
      await expect(page.getByTestId("calendar-day-modal")).toBeVisible({ timeout: 2_000 });
    }).toPass();
    const modal = page.getByTestId("calendar-day-modal");
    await expect(modal).toContainText("Campaigns to Spain on 14 Sep 2026");
    const row = modal.getByTestId("calendar-day-row").filter({ hasText: seeded.campaignName });
    await expect(row).toBeVisible();
    await expect(row).toContainText("9");
    await expect(row).toContainText("33.33%");
    await expect(modal.getByTestId("calendar-day-total")).toBeVisible();
    await page.keyboard.press("Escape");

    // An empty month: zero KPIs and no country lines. Week view keeps the grid at one row.
    await page.goto("/campaigns/scheduled?month=2024-02");
    await expect(page.getByTestId("calendar-kpi-sent")).toHaveText("0");
    await expect(page.getByTestId("calendar-country-line")).toHaveCount(0);
    await page.goto("/campaigns/scheduled?view=week&day=2026-09-14");
    await expect(page.getByTestId("calendar-title")).toHaveText("Week of 14 Sep 2026");
    await expect(page.getByTestId("calendar-day")).toHaveCount(7);
    await expect(
      page
        .locator('[data-testid="calendar-day"][data-day="2026-09-14"]')
        .getByTestId("calendar-country-line"),
    ).toHaveCount(1);
  });

  test.describe("for a viewer ahead of UTC", () => {
    test.use({ timezoneId: "Asia/Manila" });

    // QA round two saw 8 Nov circled on the morning of 9 Nov in Manila: the calendar counts
    // UTC days, like every report, so it circles the UTC date and says so.
    test("the Send Calendar circles today's UTC date and labels its days as UTC", async ({
      page,
    }) => {
      await page.goto("/campaigns/scheduled");
      await expect(page.getByTestId("calendar-utc-note")).toHaveText("Days in UTC");
      const today = page
        .getByTestId("calendar-day")
        .filter({ has: page.getByTestId("calendar-today-mark") });
      await expect(today).toHaveAttribute("data-day", new Date().toISOString().slice(0, 10));
    });
  });
});
