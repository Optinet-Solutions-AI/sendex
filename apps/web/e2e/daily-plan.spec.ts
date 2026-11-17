import { expect, test } from "@playwright/test";
import { cleanupE2ePlan, ensureDemoActivity, seedE2ePlan } from "./helpers/demo";

/**
 * The daily plan (D5-08): two campaigns planned for one day, grouped by country, offer and
 * route, against a daily target the owner sets on the page.
 */
const PREFIX = "E2E Plan";
const DAY = "2027-03-10";

test.describe("daily plan", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    ensureDemoActivity();
    await cleanupE2ePlan(PREFIX);
    await seedE2ePlan(PREFIX, DAY);
  });

  test.afterAll(async () => {
    await cleanupE2ePlan(PREFIX);
  });

  test("the day's campaigns and contacts, grouped three ways", async ({ page }) => {
    await page.goto(`/kpi/daily-plan?day=${DAY}`);
    await expect(page.getByRole("heading", { level: 1, name: "Daily Plan" })).toBeVisible();
    await expect(page.getByTestId("plan-campaigns")).toHaveText("2");
    await expect(page.getByTestId("plan-contacts")).toHaveText("640");
    await expect(page.getByTestId("plan-target")).toHaveText("Not set");

    const groups = page.getByTestId("plan-group-row");
    await expect(groups).toHaveCount(2);
    await expect(page.locator('[data-testid="plan-group-row"][data-key="GB"]')).toContainText(
      "320",
    );

    await page.getByRole("button", { name: "By offer" }).click();
    await expect(page).toHaveURL(/by=offer/);
    await expect(page.locator('[data-testid="plan-group-row"][data-key="Trixino"]')).toBeVisible();

    await page.getByRole("button", { name: "By route" }).click();
    await expect(page.locator('[data-testid="plan-group-row"][data-key="724"]')).toContainText(
      "Route 724",
    );

    const rows = page.getByTestId("plan-campaign-row");
    await expect(rows).toHaveCount(2);
    await expect(rows.filter({ hasText: "UK_ZEN_3" })).toContainText("Trixino");
    await expect(rows.filter({ hasText: "UK_ZEN_3" })).toContainText("draft");
  });

  test("the owner sets a daily target and the difference follows", async ({ page }) => {
    await page.goto(`/kpi/daily-plan?day=${DAY}`);
    await page.getByTestId("plan-edit-target").click();
    await page.getByLabel("Daily target", { exact: true }).fill("1000");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByTestId("plan-target")).toHaveText("1,000");
    await expect(page.getByTestId("plan-difference")).toHaveText("-360");

    // The next day has nothing planned and says so; the target stays.
    await page.getByRole("button", { name: "Next day" }).click();
    await expect(page).toHaveURL(/day=2027-03-11/);
    await expect(page.getByTestId("plan-empty")).toBeVisible();
    await expect(page.getByTestId("plan-difference")).toHaveText("-1,000");
  });
});
