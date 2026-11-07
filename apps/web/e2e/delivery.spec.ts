import { expect, test } from "@playwright/test";
import { cleanupE2eDelivery, type SeededDelivery, seedE2eDelivery } from "./helpers/db";

const PREFIX = "E2E Delivery";

/**
 * Delivered / failed / delivery rate and clicks / CTR / CPC on the campaign page (D3-01,
 * D2-13), as the seeded development owner. The worker is not running here, so the lap
 * counters, messages and clicks are written the way the receipt and click handlers leave them.
 */
test.describe("delivery status and click rates", () => {
  test.describe.configure({ mode: "serial" });
  let seeded: SeededDelivery;

  test.beforeAll(async () => {
    await cleanupE2eDelivery(PREFIX);
    seeded = await seedE2eDelivery(PREFIX);
  });

  test.afterAll(async () => {
    await cleanupE2eDelivery(PREFIX);
  });

  test("the header and the lap table show delivered, failed, delivery rate, clicks, CTR and CPC", async ({
    page,
  }) => {
    await page.goto(`/campaigns/${seeded.campaignId}`);
    await expect(page.getByTestId("campaign-name")).toHaveText(seeded.campaignName);

    await expect(page.getByTestId("total-sent")).toHaveText("100");
    await expect(page.getByTestId("total-delivered")).toHaveText("95");
    await expect(page.getByTestId("total-failed")).toHaveText("5");
    await expect(page.getByTestId("total-delivery-rate")).toHaveText("95.00%");
    await expect(page.getByTestId("total-clicks")).toHaveText("5");
    await expect(page.getByTestId("total-ctr")).toHaveText("5.00%");
    await expect(page.getByTestId("total-cpc")).toHaveText("€0.50");

    const row = page.getByTestId("lap-row");
    await expect(row).toHaveCount(1);
    await expect(row.getByTestId("lap-delivered")).toHaveText("95");
    await expect(row.getByTestId("lap-failed")).toHaveText("5");
    await expect(row.getByTestId("lap-delivery-rate")).toHaveText("95.00%");
    await expect(row.getByTestId("lap-clicks")).toHaveText("5");
    await expect(row.getByTestId("lap-ctr")).toHaveText("5.00%");
  });

  test("the Analytics tab breaks clicks down per route, sender id, ad text and link", async ({
    page,
  }) => {
    await page.goto(`/campaigns/${seeded.campaignId}`);
    await page.getByRole("tab", { name: "Analytics" }).click();

    const section = page.getByTestId("clicks-section");
    await expect(section).toBeVisible();
    await expect(page.getByTestId("clicks-total")).toHaveText("5");
    await expect(page.getByTestId("clicks-ctr")).toHaveText("5.00%");
    await expect(page.getByTestId("clicks-raw")).toHaveText("2");

    const byLap = page.getByTestId("clicks-by-lap").getByTestId("click-row");
    await expect(byLap).toHaveCount(1);
    await expect(byLap.first()).toContainText("405");
    await expect(byLap.first().locator("td").nth(5)).toHaveText("5.00%");

    // Two messages behind the breakdowns, one of them clicked (twice): 1 click, 50 % CTR.
    const senderRow = page
      .getByTestId("clicks-by-sender")
      .getByTestId("click-row")
      .filter({ hasText: seeded.senderId });
    await expect(senderRow).toBeVisible();
    await expect(senderRow.locator("td").nth(1)).toHaveText("2");
    await expect(senderRow.locator("td").nth(2)).toHaveText("2");
    await expect(senderRow.locator("td").nth(4)).toHaveText("1");
    await expect(senderRow.locator("td").nth(5)).toHaveText("50.00%");

    const textRow = page
      .getByTestId("clicks-by-text")
      .getByTestId("click-row")
      .filter({ hasText: seeded.adText });
    await expect(textRow.locator("td").nth(4)).toHaveText("1");

    const linkRow = page
      .getByTestId("clicks-by-link")
      .getByTestId("click-row")
      .filter({ hasText: seeded.linkName });
    await expect(linkRow.locator("td").nth(4)).toHaveText("1");
    await expect(linkRow.locator("td").nth(5)).toHaveText("50.00%");
  });
});
