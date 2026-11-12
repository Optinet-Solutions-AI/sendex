import { expect, test } from "@playwright/test";
import { cleanupE2eResults, type SeededResults, seedE2eResults } from "./helpers/db";

const PREFIX = "E2E Filters";

/**
 * D4-13: the campaigns list filters by offer, sender id and minimum clicks, leads and sales,
 * and the Period says which time zone its times are in. Uses the seeded results campaign
 * (Spain, three clicks, sent on 14 Sep 2026).
 */
test.describe("campaigns list filters", () => {
  let seeded: SeededResults;

  test.beforeAll(async () => {
    await cleanupE2eResults(PREFIX);
    seeded = await seedE2eResults(PREFIX);
  });

  test.afterAll(async () => {
    await cleanupE2eResults(PREFIX);
  });

  test("minimum clicks, sender id and offer narrow the list; the period names its zone", async ({
    page,
  }) => {
    const search = `search=${encodeURIComponent(seeded.campaignName)}`;
    await page.goto(`/campaigns?${search}`);
    const row = page.getByTestId("campaign-row").filter({ hasText: seeded.campaignName });
    await expect(row).toBeVisible();
    // 14 Sep 2026 in Europe/Madrid is summer time.
    await expect(row.getByTestId("campaign-period")).toContainText("CEST");

    // At least 1 click keeps it; at least 9,999 hides it.
    await page.getByRole("button", { name: "Filters", exact: true }).click();
    await page.getByLabel("Clicks at least").fill("1");
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page).toHaveURL(/clicksMin=1/);
    await expect(row).toBeVisible();
    await page.getByLabel("Clicks at least").fill("9999");
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page).toHaveURL(/clicksMin=9999/);
    await expect(row).toHaveCount(0);

    // A sender id nobody uses hides it too.
    await page.goto(`/campaigns?${search}&sender=ZZNOBODY`);
    await expect(row).toHaveCount(0);
    await expect(page.getByLabel("Sender ID")).toHaveValue("ZZNOBODY");

    // The Offer filter lists the organisation's offers.
    await expect(page.getByLabel("Offer").locator("option").first()).toHaveText("All offers");
    expect(await page.getByLabel("Offer").locator("option").count()).toBeGreaterThan(1);
  });
});
