import { expect, test } from "@playwright/test";
import { ensureDemoActivity } from "./helpers/demo";

/**
 * Sales Results (D5-05) on the demo activity (D5-02), in the all-time view because the demo
 * sends are dated relative to the day they were seeded.
 */
test.describe("sales results", () => {
  test.beforeAll(() => {
    ensureDemoActivity();
  });

  test("lists the days with registrations and first deposits, most sales first", async ({
    page,
  }) => {
    await page.goto("/kpi/sales-results?period=all");
    await expect(page.getByRole("heading", { level: 1, name: "Sales Results" })).toBeVisible();

    await expect(page.getByTestId("results-sales")).not.toHaveText("0");
    await expect(page.getByTestId("results-leads")).not.toHaveText("0");
    await expect(page.getByTestId("results-revenue")).toContainText("€");

    const rows = page.getByTestId("sales-result-row");
    await expect(rows.first()).toBeVisible();
    // Every line names its offer, route, list and data provider.
    const zen = rows.filter({ hasText: "UK_ZEN_1" }).first();
    await expect(zen).toContainText("ZEN");
    await expect(zen).toContainText("United Kingdom");
    await expect(zen).toContainText(/Route (724|137)/);

    const sales = await rows.locator('[data-col="sales"]').allTextContents();
    const numbers = sales.map((s) => Number(s));
    expect(numbers).toEqual([...numbers].sort((a, b) => b - a));
  });

  test("a column header reorders the table and the choice lives in the address bar", async ({
    page,
  }) => {
    await page.goto("/kpi/sales-results?period=all");
    await page.getByTestId("sort-leads").click();
    await expect(page).toHaveURL(/sort=leads/);
    const leads = await page
      .getByTestId("sales-result-row")
      .locator('[data-col="leads"]')
      .allTextContents();
    const numbers = leads.map((s) => Number(s));
    expect(numbers).toEqual([...numbers].sort((a, b) => b - a));

    // A month with nothing in it says so.
    await page.goto("/kpi/sales-results?year=2025&month=1");
    await expect(page.getByTestId("sales-results-empty")).toContainText("January 2025");
  });
});
