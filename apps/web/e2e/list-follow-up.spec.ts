import { expect, test } from "@playwright/test";
import { ensureDemoActivity } from "./helpers/demo";

/**
 * List Follow-Up (D5-03) on the demo activity (D5-02): the United Kingdom has four lists that
 * were sent and two that were not; with an offer picked, a list that only went to other offers
 * moves under "Never sent to …".
 */
test.describe("list follow-up", () => {
  test.beforeAll(() => {
    ensureDemoActivity();
  });

  test("countries with their sent lists, and the lists not sent yet", async ({ page }) => {
    await page.goto("/kpi/list-follow-up");
    await expect(page.getByRole("heading", { level: 1, name: "List Follow-Up" })).toBeVisible();

    const gb = page.locator('[data-testid="follow-up-country-row"][data-country="GB"]');
    await expect(gb).toBeVisible();
    await expect(gb.locator('[data-col="lists"]')).toHaveText("4");
    await expect(gb.locator('[data-col="sales"]')).not.toHaveText("0");
    await expect(gb.locator('[data-col="roi"]')).toContainText("%");

    // The lists of a country open under it, with their data provider.
    await expect(page.getByTestId("follow-up-list-row")).toHaveCount(0);
    await gb.getByRole("button", { name: "Show the lists of United Kingdom" }).click();
    const zen1 = page.locator('[data-testid="follow-up-list-row"][data-list="UK_ZEN_1"]');
    await expect(zen1).toBeVisible();
    await expect(zen1).toContainText("ZEN");
    await expect(page.getByTestId("follow-up-list-row")).toHaveCount(4);

    // Untouched lists are listed apart.
    const untouched = page.getByTestId("follow-up-untouched");
    await expect(untouched).toContainText("Not sent yet");
    await expect(untouched.locator('[data-list="UK_ZEN_3"]')).toBeVisible();
    await expect(untouched.locator('[data-list="UK_RIS_1"]')).toBeVisible();
    await expect(untouched.locator('[data-list="UK_ZEN_1"]')).toHaveCount(0);
  });

  test("an offer narrows it to that offer and shows what was never sent to it", async ({
    page,
  }) => {
    await page.goto("/kpi/list-follow-up");
    await page.getByRole("combobox", { name: "Offer" }).click();
    await page.getByRole("option", { name: "Trixino" }).click();
    await expect(page).toHaveURL(/offer=/);

    const untouched = page.getByTestId("follow-up-untouched");
    await expect(untouched).toContainText("Never sent to Trixino");
    await expect(untouched.locator('[data-list="UK_DIM_1"]')).toBeVisible();

    const gb = page.locator('[data-testid="follow-up-country-row"][data-country="GB"]');
    await expect(gb.locator('[data-col="lists"]')).toHaveText("3");
    // Poland never got this offer, so it has no row.
    await expect(
      page.locator('[data-testid="follow-up-country-row"][data-country="PL"]'),
    ).toHaveCount(0);

    await page.getByTestId("follow-up-clear").click();
    await expect(page).toHaveURL(/\/kpi\/list-follow-up$/);
    await expect(
      page.locator('[data-testid="follow-up-country-row"][data-country="PL"]'),
    ).toBeVisible();
  });

  test("the search narrows the lists by name", async ({ page }) => {
    await page.goto("/kpi/list-follow-up");
    await page.getByTestId("follow-up-search").fill("PL_");
    await page.getByTestId("follow-up-search").press("Enter");
    await expect(page).toHaveURL(/q=PL_/);
    await expect(page.getByTestId("follow-up-country-row")).toHaveCount(1);
    await expect(
      page.locator('[data-testid="follow-up-country-row"][data-country="PL"]'),
    ).toBeVisible();
  });
});
