import { expect, type Page, test } from "@playwright/test";
import { cleanupE2eControlCampaigns } from "./helpers/db";

/**
 * D4-09: the routes picked on the send form are saved on the campaign, so they are still picked
 * when it is opened again, and Duplicate copies them (decisions item 40).
 */
const PREFIX = "E2E Routes";

async function cleanup() {
  await cleanupE2eControlCampaigns(PREFIX);
  await cleanupE2eControlCampaigns(`Copy of ${PREFIX}`);
}

test.beforeAll(cleanup);
test.afterAll(cleanup);

async function openRoutes(page: Page) {
  await page
    .getByTestId("schedule-panel")
    .getByRole("button", { name: "Routes", exact: true })
    .click();
}

test("picked routes stay picked after a reload and a duplicate keeps them", async ({ page }) => {
  const name = `${PREFIX} ${Date.now()}`;
  // A fresh dev server can fail the very first page load ("expected layout router to be
  // mounted"); load the list until it is usable.
  await expect(async () => {
    await page.goto("/campaigns");
    await expect(page.getByTestId("new-campaign")).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 60_000 });
  await page.getByTestId("new-campaign").click();
  const dialog = page.getByRole("dialog", { name: "New Campaign" });
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByLabel("Country").selectOption("ES");
  await dialog.getByRole("button", { name: "Create campaign" }).click();
  await expect(page).toHaveURL(/\/campaigns\/[0-9a-f-]{36}$/);

  await openRoutes(page);
  await page.getByTestId("route-405").check();
  await page.getByTestId("route-403").check();

  // The choice is saved in the background; the Routes row is busy until every save is done.
  const routesRow = page.getByTestId("routes-row");
  await expect(routesRow).toHaveAttribute("aria-busy", "false");
  await page.reload();
  await openRoutes(page);
  await expect(page.getByTestId("route-405")).toBeChecked();
  await expect(page.getByTestId("route-403")).toBeChecked();

  // Unpicking is saved too.
  await page.getByTestId("route-403").uncheck();
  await expect(routesRow).toHaveAttribute("aria-busy", "false");
  await page.reload();
  await openRoutes(page);
  await expect(page.getByTestId("route-403")).not.toBeChecked();
  await expect(page.getByTestId("route-405")).toBeChecked();

  // Duplicate from the campaigns list: the copy opens with route 405 picked.
  await page.goto(`/campaigns?search=${encodeURIComponent(name)}`);
  await page.getByRole("button", { name: `Duplicate ${name}` }).click();
  await expect(page).toHaveURL(/\/campaigns\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId("campaign-name")).toHaveText(`Copy of ${name}`);
  await openRoutes(page);
  await expect(page.getByTestId("route-405")).toBeChecked();
  await expect(page.getByTestId("route-403")).not.toBeChecked();
});
