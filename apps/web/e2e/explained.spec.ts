import { expect, test } from "@playwright/test";
import { cleanupE2eResults, type SeededResults, seedE2eResults } from "./helpers/db";

const PREFIX = "E2E Explained";

/**
 * D5-20: computed figures explain themselves. Hovering a header shows its formula;
 * hovering a figure shows the formula and the sum with the numbers on screen.
 */
test.describe("hover explanations", () => {
  test.describe.configure({ mode: "serial" });
  let seeded: SeededResults;

  test.beforeAll(async () => {
    await cleanupE2eResults(PREFIX);
    seeded = await seedE2eResults(PREFIX);
  });
  test.afterAll(() => cleanupE2eResults(PREFIX));

  test("a figure shows its formula and the sum with the numbers on screen", async ({ page }) => {
    await page.goto(`/campaigns/${seeded.campaignId}`);
    const ctr = page.getByTestId("total-ctr");
    await expect(ctr).toHaveText("44.44%");
    // The page is server-rendered first: retry until it is interactive and the bubble opens.
    const tip = page.getByRole("tooltip");
    await expect(async () => {
      await page.locator("body").click({ position: { x: 1, y: 1 } });
      await ctr.locator("span[tabindex='0']").focus();
      await expect(tip).toContainText("CTR = Clicks ÷ Sent", { timeout: 1500 });
    }).toPass({ timeout: 20_000 });
    await expect(tip).toContainText(
      `${seeded.sql.clicks} clicks ÷ ${seeded.sql.sent} sent = 44.44%`,
    );
  });

  test("a table header shows its formula", async ({ page }) => {
    await page.goto("/campaigns");
    await expect(async () => {
      await page.getByRole("columnheader", { name: "CTR" }).getByText("CTR").hover();
      await expect(page.getByRole("tooltip")).toContainText("CTR = Clicks ÷ Sent", {
        timeout: 1500,
      });
    }).toPass({ timeout: 20_000 });
  });

  test("the Dashboard ROI headers show theirs", async ({ page }) => {
    await page.goto("/?tab=roi&range=all");
    await expect(async () => {
      await page.getByRole("columnheader", { name: "CPC" }).getByText("CPC").hover();
      await expect(page.getByRole("tooltip")).toContainText("CPC = Cost ÷ Clicks", {
        timeout: 1500,
      });
    }).toPass({ timeout: 20_000 });
  });
});
