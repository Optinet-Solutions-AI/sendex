import { expect, type Page, test } from "@playwright/test";
import { cleanupE2eControlCampaigns, type SeededRouteTest, seedE2eRouteTest } from "./helpers/db";

/**
 * D4-18: after a test on several routes, one button removes the picked routes that brought no
 * clicks (decisions item 27: "delete the routes that brought in zero clicks").
 */
const PREFIX = "E2E Zero clicks";

let seeded: SeededRouteTest;

test.beforeAll(async () => {
  await cleanupE2eControlCampaigns(PREFIX);
  seeded = await seedE2eRouteTest(PREFIX);
});

test.afterAll(async () => {
  await cleanupE2eControlCampaigns(PREFIX);
});

async function openRoutes(page: Page) {
  await page
    .getByTestId("schedule-panel")
    .getByRole("button", { name: "Routes", exact: true })
    .click();
}

test("the routes panel shows each route's result and removes the ones with no clicks", async ({
  page,
}) => {
  // A fresh dev server can fail the very first page load; load until the page is usable.
  await expect(async () => {
    await page.goto(`/campaigns/${seeded.campaignId}`);
    await expect(page.getByTestId("routes-row")).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 60_000 });

  await openRoutes(page);
  await expect(page.getByTestId("route-405")).toBeChecked();
  await expect(page.getByTestId("route-403")).toBeChecked();
  // This campaign's own numbers sit beside each route.
  await expect(page.getByTestId("route-result-405")).toHaveText("5 sent · 2 clicks");
  await expect(page.getByTestId("route-result-403")).toHaveText("5 sent · 0 clicks");

  const button = page.getByTestId("drop-zero-click");
  await expect(button).toHaveText("Remove 1 route with no clicks");
  // The click must land after hydration, so retry until the route is unticked.
  await expect(async () => {
    if (await button.isVisible()) await button.click();
    await expect(page.getByTestId("route-403")).not.toBeChecked({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await expect(page.getByTestId("route-405")).toBeChecked();
  await expect(button).toHaveCount(0);

  // Saved on the campaign: still gone after a reload.
  await expect(page.getByTestId("routes-row")).toHaveAttribute("aria-busy", "false");
  await page.reload();
  await openRoutes(page);
  await expect(page.getByTestId("route-403")).not.toBeChecked();
  await expect(page.getByTestId("route-405")).toBeChecked();
});
