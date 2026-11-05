import { expect, test } from "@playwright/test";
import { cleanupE2eResults, type SeededResults, seedE2eResults } from "./helpers/db";

const PREFIX = "E2E Results";

/**
 * The campaign results page (D3-05) as the seeded development owner: the header totals and
 * the lap table equal the SQL sums over the seeded laps, the laps sort by rank, a lap can be
 * switched off and on, and the Analytics tab reconciles with the message and click tables.
 */
test.describe("campaign results", () => {
  test.describe.configure({ mode: "serial" });
  let seeded: SeededResults;

  test.beforeAll(async () => {
    await cleanupE2eResults(PREFIX);
    seeded = await seedE2eResults(PREFIX);
  });

  test.afterAll(async () => {
    await cleanupE2eResults(PREFIX);
  });

  test("header totals and the lap table equal the SQL counts, sorted by rank", async ({ page }) => {
    await page.goto(`/campaigns/${seeded.campaignId}`);
    await expect(page.getByTestId("campaign-name")).toHaveText(seeded.campaignName);

    const s = seeded.sql;
    await expect(page.getByTestId("total-sent")).toHaveText(String(s.sent));
    await expect(page.getByTestId("total-delivered")).toHaveText(String(s.delivered));
    await expect(page.getByTestId("total-failed")).toHaveText(String(s.failed));
    await expect(page.getByTestId("total-clicks")).toHaveText(String(s.clicks));
    await expect(page.getByTestId("total-leads")).toHaveText(String(s.leads));
    await expect(page.getByTestId("total-sales")).toHaveText(String(s.sales));
    await expect(page.getByTestId("total-cost")).toHaveText(
      `EUR ${(s.costMicro / 1_000_000).toFixed(2)}`,
    );
    // 4 clicks on 9 sent, EUR 0.225 / 4 clicks.
    await expect(page.getByTestId("total-ctr")).toHaveText("44.44%");
    await expect(page.getByTestId("total-cpc")).toHaveText("EUR 0.06");
    await expect(page.getByTestId("sending-progress")).toContainText(`${s.sent} /`);

    const rows = page.getByTestId("lap-row");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toHaveAttribute("data-lap-rank", "1");
    await expect(rows.nth(0)).toContainText("405");
    await expect(rows.nth(0).getByTestId("lap-sent")).toHaveText("5");
    await expect(rows.nth(0).getByTestId("lap-clicks")).toHaveText("3");
    await expect(rows.nth(0)).toContainText("60.00%");
    await expect(rows.nth(1)).toHaveAttribute("data-lap-rank", "2");
    await expect(rows.nth(1)).toContainText("403");

    // Sorting by sent descending keeps 405 first; ascending puts 403 first.
    await page.getByTestId("sort-sent").click();
    await expect(rows.nth(0)).toContainText("405");
    await page.getByTestId("sort-sent").click();
    await expect(rows.nth(0)).toContainText("403");
    await page.getByTestId("sort-rank").click();
    await expect(rows.nth(0)).toHaveAttribute("data-lap-rank", "1");
  });

  test("a lap can be switched off and on again; a finished lap cannot", async ({ page }) => {
    await page.goto(`/campaigns/${seeded.campaignId}`);
    const lap403 = page.locator(`[data-lap-id="${seeded.lap403Id}"]`);
    const lap405 = page.locator(`[data-lap-id="${seeded.lap405Id}"]`);
    await expect(lap403).toHaveAttribute("data-lap-status", "sending");
    await expect(lap405.getByTestId("lap-toggle")).toBeDisabled();

    await lap403.getByTestId("lap-toggle").click();
    await expect(lap403).toHaveAttribute("data-lap-status", "cancelled");
    await expect(lap403.getByTestId("lap-toggle")).toHaveAttribute("aria-checked", "false");

    await lap403.getByTestId("lap-toggle").click();
    await expect(lap403).toHaveAttribute("data-lap-status", "queued");
    await expect(lap403.getByTestId("lap-toggle")).toHaveAttribute("aria-checked", "true");

    // Both flips are in the campaign log.
    await page.getByRole("tab", { name: "Logs" }).click();
    await expect(page.getByTestId("logs-table")).toContainText("lap.toggle");
  });

  test("the Analytics tab reconciles networks, clicks per hour and clicks per link", async ({
    page,
  }) => {
    await page.goto(`/campaigns/${seeded.campaignId}`);
    await page.getByRole("tab", { name: "Analytics" }).click();

    await expect(page.getByTestId("networks-note")).toContainText("route and provider");
    const r405 = page.locator('[data-testid="network-row"][data-route="405"]');
    await expect(r405.locator("td").nth(2)).toHaveText(String(seeded.sql.messagesSubmitted405));
    await expect(r405.locator("td").nth(6)).toHaveText(String(seeded.sql.clicks405));
    const r403 = page.locator('[data-testid="network-row"][data-route="403"]');
    await expect(r403.locator("td").nth(2)).toHaveText("4");
    await expect(r403.locator("td").nth(5)).toHaveText("2");

    const hours = page.getByTestId("clicks-hour");
    await expect(hours).toHaveCount(2);
    await expect(hours.nth(0)).toHaveAttribute("data-hour", "0");
    await expect(hours.nth(0).getByTestId("clicks-hour-count")).toHaveText("3");
    await expect(hours.nth(1)).toHaveAttribute("data-hour", "2");
    await expect(hours.nth(1).getByTestId("clicks-hour-count")).toHaveText("1");

    const linkRow = page.getByTestId("link-row").filter({ hasText: `${PREFIX} link` });
    await expect(linkRow.locator("td").nth(2)).toHaveText("9");
    await expect(linkRow.locator("td").nth(3)).toHaveText(String(seeded.sql.clicks));
  });
});
