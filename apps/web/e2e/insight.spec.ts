import { expect, test } from "@playwright/test";
import { ensureDemoActivity } from "./helpers/demo";

/**
 * Performance Insight (D5-04) on the demo activity (D5-02). The all-time view is used for the
 * figures because the demo sends are dated relative to the day they were seeded.
 */
test.describe("performance insight", () => {
  test.beforeAll(() => {
    ensureDemoActivity();
  });

  test("totals, per-sale figures and the rankings by offer and country", async ({ page }) => {
    await page.goto("/kpi/insight?period=all");
    await expect(
      page.getByRole("heading", { level: 1, name: "Performance Insight" }),
    ).toBeVisible();

    await expect(page.getByTestId("insight-sales")).not.toHaveText("0");
    await expect(page.getByTestId("insight-revenue")).toContainText("€");
    await expect(page.getByTestId("insight-cost")).toContainText("€");
    await expect(page.getByTestId("insight-sms-per-sale")).not.toHaveText("–");
    await expect(page.getByTestId("insight-cost-per-sale")).toContainText("€");

    await expect(page.getByTestId("insight-offers-roi")).toContainText("Rolling Slots");
    await expect(page.getByTestId("insight-roi-country")).toContainText("United Kingdom");
    await expect(page.getByTestId("insight-sales-country")).toContainText("United Kingdom");

    // The first country is open with its offers; the others open on a click.
    const countries = page.getByTestId("insight-country");
    await expect(countries.first().getByTestId("insight-offer-row").first()).toBeVisible();
    const poland = page.locator('[data-testid="insight-country"][data-country="PL"]');
    await poland.locator("summary").click();
    await expect(poland.getByTestId("insight-offer-row").first()).toContainText("Lucky Reel");

    const efficiency = page.getByTestId("efficiency-item");
    await expect(efficiency.first()).toBeVisible();
    expect(await efficiency.count()).toBeLessThanOrEqual(6);
  });

  test("the sort and the period live in the address bar, and an empty period says so", async ({
    page,
  }) => {
    await page.goto("/kpi/insight?period=all");
    await page.getByRole("button", { name: "Sort by sales" }).click();
    await expect(page).toHaveURL(/sort=sales/);
    await expect(page.getByRole("button", { name: "Sort by sales" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await page.getByRole("button", { name: "Month", exact: true }).click();
    await expect(page).toHaveURL(/month=/);
    await page.getByRole("combobox", { name: "Year" }).click();
    await page.getByRole("option", { name: "2025" }).click();
    await expect(page).toHaveURL(/year=2025/);
    await page.getByRole("combobox", { name: "Month" }).click();
    await page.getByRole("option", { name: "January" }).click();
    await expect(page).toHaveURL(/month=1(&|$)/);
    await expect(page.getByTestId("insight-empty")).toContainText("January 2025");
    await expect(page.getByTestId("insight-sales")).toHaveText("0");
  });
});
