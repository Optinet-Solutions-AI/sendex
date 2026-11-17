import { expect, test } from "@playwright/test";
import { ensureDemoActivity, latestDemoMonth } from "./helpers/demo";

/**
 * Trends (D5-06) on the demo activity (D5-02), in the month of the latest demo send.
 */
test.describe("trends", () => {
  let month: { year: number; month: number };

  test.beforeAll(async () => {
    ensureDemoActivity();
    month = await latestDemoMonth();
  });

  test("the month's tiles, both charts and the breakdown by route", async ({ page }) => {
    await page.goto(`/kpi/trends?year=${month.year}&month=${month.month}`);
    await expect(page.getByRole("heading", { level: 1, name: "Trends" })).toBeVisible();

    await expect(page.getByTestId("trends-leads")).not.toHaveText("0");
    await expect(page.getByTestId("trends-sales")).not.toHaveText("0");
    await expect(page.getByTestId("trends-conversion")).toContainText("%");
    await expect(page.getByTestId("trends-leads-chart")).toContainText("Leads (cumulative)");
    await expect(page.getByTestId("trends-leads-chart")).toContainText("Leads, month before");
    await expect(page.getByTestId("trends-sales-chart")).toContainText("Sales (cumulative)");

    const rows = page.getByTestId("trends-breakdown-row");
    await expect(rows.first()).toBeVisible();
    await expect(
      page.locator('[data-testid="trends-breakdown-row"][data-key="724"]'),
    ).toBeVisible();
  });

  test("grouping, daily figures and the comparison live in the address bar", async ({ page }) => {
    await page.goto(`/kpi/trends?year=${month.year}&month=${month.month}`);

    await page.getByRole("combobox", { name: "Group by" }).click();
    await page.getByRole("option", { name: "By data provider" }).click();
    await expect(page).toHaveURL(/by=provider/);
    await expect(
      page.locator('[data-testid="trends-breakdown-row"][data-key="ZEN"]'),
    ).toBeVisible();

    await page.getByRole("button", { name: "Daily", exact: true }).click();
    await expect(page).toHaveURL(/mode=daily/);
    await expect(page.getByTestId("trends-leads-chart")).toContainText("Leads (daily)");

    await page.getByRole("checkbox", { name: "vs the month before" }).click();
    await expect(page).toHaveURL(/compare=0/);
    await expect(page.getByTestId("trends-leads-chart")).not.toContainText("Leads, month before");

    // A month with nothing in it says so.
    await page.goto("/kpi/trends?year=2025&month=1");
    await expect(page.getByTestId("trends-empty")).toContainText("January 2025");
  });
});
