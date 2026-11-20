import { expect, type Page, test } from "@playwright/test";
import { stepsFor } from "../components/tour/steps";
import { ensureDemoActivity, setDemoPreview, setDemoPreviewToggle } from "./helpers/demo";

/**
 * The Performance tour (D5-12): it starts by itself the first time the new pages are shown in
 * a browser, walks every page with Next, does not start again once finished, and the Tour
 * button replays it. The other specs switch the automatic start off through the shared
 * storage state; this one starts from a clean browser.
 */
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("Performance tour", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(() => {
    ensureDemoActivity();
  });

  test.afterAll(async () => {
    await setDemoPreviewToggle(false);
    await setDemoPreview(true);
  });

  const card = (page: Page) => page.getByTestId("tour-card");

  test("starts on the first switch to New, walks every page, then stays closed", async ({
    page,
  }) => {
    await setDemoPreview(false);
    await setDemoPreviewToggle(true);
    const total = stepsFor({ hasSwitch: true }).length;

    await page.goto("/");
    await expect(card(page)).toHaveCount(0);
    await page.getByTestId("view-toggle").getByRole("button", { name: "New" }).click();
    await expect(card(page)).toContainText(`1 of ${total}`);
    await expect(card(page)).toContainText("Business KPI: what's new");

    const steps = stepsFor({ hasSwitch: true });
    const visited = new Set<string>();
    for (let step = 2; step <= total; step += 1) {
      await card(page).getByRole("button", { name: "Next" }).click();
      // The card waits for its page, so seeing it means the page has opened.
      await expect(card(page)).toContainText(`${step} of ${total}`, { timeout: 30_000 });
      await expect(card(page)).toContainText(steps[step - 1]?.title ?? "");
      visited.add(new URL(page.url()).pathname);
    }
    expect([...visited]).toEqual(
      expect.arrayContaining([
        "/kpi/insight",
        "/kpi/sales-results",
        "/kpi/trends",
        "/kpi/list-follow-up",
        "/kpi/daily-plan",
        "/lists",
      ]),
    );
    await card(page).getByRole("button", { name: "Finish" }).click();
    await expect(card(page)).toHaveCount(0);

    await page.reload();
    await expect(page.getByTestId("tour-button")).toBeVisible();
    await expect(card(page)).toHaveCount(0);
  });

  test("the Tour button replays it, Back goes back and Escape closes it", async ({ page }) => {
    await setDemoPreview(false);
    await setDemoPreviewToggle(true);
    await page.goto("/");
    await page.getByTestId("view-toggle").getByRole("button", { name: "New" }).click();
    await card(page).getByRole("button", { name: "Skip" }).click();
    await expect(card(page)).toHaveCount(0);

    await page.getByTestId("tour-button").click();
    await expect(card(page)).toContainText("1 of");
    await card(page).getByRole("button", { name: "Next" }).click();
    await expect(card(page)).toContainText("2 of");
    await card(page).getByRole("button", { name: "Back" }).click();
    await expect(card(page)).toContainText("1 of");
    await page.keyboard.press("Escape");
    await expect(card(page)).toHaveCount(0);
  });

  test("an organisation with Performance always on gets the tour without a switch", async ({
    page,
  }) => {
    await setDemoPreviewToggle(false);
    await setDemoPreview(true);
    const total = stepsFor({ hasSwitch: false }).length;
    await page.goto("/");
    await expect(card(page)).toContainText(`1 of ${total}`);
    await expect(page.getByTestId("tour-button")).toBeVisible();
    await expect(page.getByTestId("view-toggle")).toHaveCount(0);
  });
});
