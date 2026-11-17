import { expect, test } from "@playwright/test";
import { ensureDemoActivity, setDemoPreview } from "./helpers/demo";

/**
 * The preview switch (D5-09): the Performance screens and the list data provider are shown
 * only to an organisation that has the preview on. With it off the app looks as it did
 * before: no menu group, the pages answer "not found", no Data provider field.
 */
test.describe("preview features switch", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(() => {
    ensureDemoActivity();
  });

  // Whatever happens, leave the demo organisation with the preview on for the other specs.
  test.afterAll(async () => {
    await setDemoPreview(true);
  });

  test("off: no Performance menu, the pages are not found, no data provider", async ({ page }) => {
    await setDemoPreview(false);

    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Main" });
    await nav.hover();
    await expect(nav.getByRole("button", { name: "Campaigns", exact: true })).toBeVisible();
    await expect(nav.getByRole("button", { name: "Performance", exact: true })).toHaveCount(0);

    for (const path of [
      "/kpi/insight",
      "/kpi/sales-results",
      "/kpi/trends",
      "/kpi/list-follow-up",
      "/kpi/daily-plan",
    ]) {
      // The page streams, so the status stays 200; what is shown is the "not found" page.
      await page.goto(path);
      await expect(page.getByText("This page could not be found."), path).toBeVisible();
      await expect(
        page
          .getByRole("heading", { level: 1 })
          .filter({ hasText: /Insight|Results|Trends|Follow-Up|Plan/ }),
      ).toHaveCount(0);
    }

    await page.goto("/lists/upload");
    await page.getByRole("button", { name: "Paste CSV" }).click();
    await page.getByLabel("Paste phone numbers, one per line").fill("447700900123");
    await page.getByRole("button", { name: "Upload", exact: true }).click();
    await expect(page.getByLabel("New List Name")).toBeVisible();
    await expect(page.getByLabel(/Data provider/)).toHaveCount(0);

    await page.goto("/lists");
    await page.getByRole("link", { name: "UK_ZEN_1", exact: true }).click();
    await expect(page.getByTestId("count-members")).toBeVisible();
    await expect(page.getByTestId("list-provider")).toHaveCount(0);
  });

  test("on: the menu, the pages and the data provider are back", async ({ page }) => {
    await setDemoPreview(true);

    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Main" });
    await nav.hover();
    await nav.getByRole("button", { name: "Performance", exact: true }).click();
    await nav.getByRole("link", { name: "List Follow-Up", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "List Follow-Up" })).toBeVisible();

    await page.goto("/lists");
    await page.getByRole("link", { name: "UK_ZEN_1", exact: true }).click();
    await expect(page.getByTestId("list-provider")).toHaveText("ZEN");
  });
});
