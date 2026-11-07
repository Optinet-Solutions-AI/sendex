import { expect, test } from "@playwright/test";
import { cleanupE2eRoutes } from "./helpers/db";

const PREFIX = "E2E Route";

/**
 * Routes (D4-06): Platform Routes lists the seeded catalogue and the delivery report; a
 * custom HTTP route is created, priced, locked in for Malta, switched off and deleted;
 * Send Single queues a test that the Testing table lists; Mobile Networks renders.
 */
test.describe("routes", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    await cleanupE2eRoutes(PREFIX);
  });

  test.afterAll(async () => {
    await cleanupE2eRoutes(PREFIX);
  });

  test("Platform Routes shows the catalogue, the delivery report and the KPI strip", async ({
    page,
  }) => {
    await page.goto("/routes/platform");
    await expect(page.getByRole("heading", { level: 1, name: "Platform Routes" })).toBeVisible();
    await expect(page.getByTestId("catalogue-row").first()).toBeVisible();
    const routes = Number((await page.getByTestId("kpi-routes").textContent()) ?? "0");
    expect(routes).toBeGreaterThan(0);
    await page.getByTestId("routes-search").fill("405");
    await page.getByTestId("routes-search").press("Enter");
    await expect(page).toHaveURL(/q=405/);
    await expect(page.getByTestId("catalogue-row")).toHaveCount(1);
    await expect(page.getByTestId("catalogue-row").first()).toContainText("Route 405");
    await page.getByTestId("range-30d").click();
    await expect(page).toHaveURL(/range=30d/);
  });

  test("a custom HTTP route is created, priced, used in an exception, switched off and deleted", async ({
    page,
  }) => {
    const name = `${PREFIX} ${Date.now()}`;
    await page.goto("/routes/custom");
    await expect(page.getByRole("heading", { level: 1, name: "Custom Routes" })).toBeVisible();
    await page.getByTestId("add-route").click();
    const dialog = page.getByTestId("route-dialog");
    await dialog.getByTestId("route-name").fill(name);
    await dialog
      .getByTestId("route-api-url")
      .fill("https://gw.example.com/send?to={{{number}}}&text={{{text}}}&from={{{from}}}");
    await dialog.getByTestId("add-header").click();
    await dialog.getByLabel("Header 1 name").fill("X-Key");
    await dialog.getByLabel("Header 1 value").fill("k");
    await dialog.getByTestId("route-submit").click();
    await expect(page.getByTestId("toast").last()).toContainText("Route created");
    const row = page.getByTestId("custom-route-row").filter({ hasText: name });
    await expect(row).toBeVisible();
    await expect(row).toContainText("gw.example.com");
    await expect(row).toContainText("HTTP");
    await expect(row).toContainText("No pricing");

    // Pricing: Malta at EUR 0.05.
    await row.getByTestId("route-pricing").click();
    const pricing = page.getByTestId("pricing-dialog");
    await pricing.getByTestId("add-price").click();
    await pricing.getByLabel("Country 1").selectOption("MT");
    await pricing.getByLabel("Price 1 (EUR)").fill("0.05");
    await pricing.getByTestId("pricing-submit").click();
    await expect(page.getByTestId("toast").last()).toContainText("Prices saved");
    // Read the saved price back from the server rather than waiting on the client refresh.
    await page.reload();
    await expect(row).not.toContainText("No pricing");

    // Routing Configuration: pick a strategy and lock Malta to the new route.
    await page.goto("/routes/custom?tab=routing");
    await page.getByTestId("strategy-platform_first").click();
    await expect(page.getByTestId("strategy-platform_first")).toContainText("Active");
    await page.getByTestId("exception-country").selectOption("MT");
    await page.getByTestId("exception-locked").selectOption({ label: name });
    await page.getByTestId("exception-save").click();
    await expect(page.getByTestId("exception-row")).toContainText("Malta");
    await page.getByTestId("strategy-custom_first").click();
    await expect(page.getByTestId("strategy-custom_first")).toContainText("Active");

    // Stats tab renders its three cards.
    await page.goto("/routes/custom?tab=stats");
    await expect(page.getByTestId("custom-stats")).toContainText("Sending Statistics");

    // Off, then delete.
    await page.goto("/routes/custom");
    await row.getByTestId("route-eye").click();
    await expect(row).toHaveAttribute("data-active", "false");
    await row.getByTestId("route-delete").click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
    await expect(page.getByTestId("toast").last()).toContainText("Route deleted");
    await expect(page.getByTestId("custom-route-row").filter({ hasText: name })).toHaveCount(0);
  });

  test("Send Single queues a test that the Testing table lists, and Mobile Networks renders", async ({
    page,
  }) => {
    await page.goto("/routes/testing");
    await expect(page.getByRole("heading", { level: 1, name: "SMS Tests" })).toBeVisible();
    await page.getByTestId("open-send-single").click();
    const form = page.getByTestId("send-single-form");
    await form.getByTestId("single-country").selectOption("ES");
    await form.getByTestId("single-recipient").fill("34600000001");
    const routes = form.getByTestId("single-routes");
    await expect(routes).toBeVisible();
    await routes.getByLabel(/Route 405/).check();
    await form.getByTestId("sender-random_shop").check();
    await expect(form.getByTestId("estimate-tests")).toHaveText("2");
    await form.getByLabel("Hypothesis").fill(`${PREFIX} hypothesis`);
    await form.getByTestId("single-send").click();
    await expect(page.getByTestId("toast").last()).toContainText("Test queued");
    const row = page.getByTestId("test-row").first();
    await expect(row).toBeVisible();
    await expect(row).toContainText("Spain");
    await expect(row).toContainText("405");
    await expect(row.getByText(/queued|running|done|failed/)).toBeVisible();
    await row.getByTestId("test-remove").click();
    await expect(page.getByTestId("tests-count")).toContainText("Showing 0-0 of 0 items");
    await page.getByTestId("show-removed").click();
    await expect(page).toHaveURL(/removed=1/);
    await expect(page.getByTestId("test-row").first()).toBeVisible();

    await page.goto("/routes/mobile-networks?range=all");
    await expect(page.getByRole("heading", { level: 1, name: "Mobile Networks" })).toBeVisible();
    await expect(page.getByTestId("net-kpi-countries")).toBeVisible();
  });
});
