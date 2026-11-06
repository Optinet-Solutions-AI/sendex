import { expect, test } from "@playwright/test";
import { cleanupE2ePostbacks, type SeededPostback, seedE2ePostback } from "./helpers/db";

const PREFIX = "E2E Postbacks";

/**
 * The postback log and the campaign conversions as the seeded development owner
 * (`SENDEX_DEV_AUTH=1`, organisation "external"). The worker is not running here, so the
 * lead is written straight into the database the way the ingest handler would store it.
 */
test.describe("postbacks", () => {
  // One worker: the three tests share the rows seeded once in beforeAll.
  test.describe.configure({ mode: "serial" });
  let seeded: SeededPostback;

  test.beforeAll(async () => {
    await cleanupE2ePostbacks(PREFIX);
    seeded = await seedE2ePostback(PREFIX);
  });

  test.afterAll(async () => {
    await cleanupE2ePostbacks(PREFIX);
  });

  test("the Reports page lists the lead with its campaign, filters and exports it", async ({
    page,
  }) => {
    await page.goto("/reports/postbacks");
    await expect(page.getByRole("heading", { level: 1, name: "Postback Logs" })).toBeVisible();

    const row = page.getByTestId(`postback-row-${seeded.eventKey}`);
    await expect(row).toBeVisible();
    await expect(row).toContainText("lead");
    await expect(row).toContainText(seeded.campaignName);
    await expect(row).toContainText("sub_id=e2e");

    // Sales only: the lead disappears. Leads only: it is back.
    await page.getByTestId("type-filter-sale").click();
    await expect(page).toHaveURL(/type=sale/);
    await expect(row).toHaveCount(0);
    await page.getByTestId("type-filter-lead").click();
    await expect(row).toBeVisible();

    // Search by event key narrows the log to this one event.
    await page.getByLabel("Search postbacks").fill(seeded.eventKey);
    await page.getByRole("button", { name: "Search" }).click();
    await expect(page.getByTestId("postbacks-count")).toHaveText("1 event");
    await expect(row).toBeVisible();

    // The CSV export carries the same filters.
    const csv = await page.request.get(`/reports/postbacks/export?search=${seeded.eventKey}`);
    expect(csv.ok()).toBe(true);
    expect(csv.headers()["content-type"]).toContain("text/csv");
    const body = await csv.text();
    expect(body).toContain("Event key,Type,Campaign");
    expect(body).toContain(seeded.eventKey);
    expect(body).toContain(seeded.campaignName);
  });

  test("the campaign Analytics tab shows the lead per sender id and ad text", async ({ page }) => {
    await page.goto(`/campaigns/${seeded.campaignId}`);
    await expect(page.getByTestId("campaign-name")).toHaveText(seeded.campaignName);
    await page.getByRole("tab", { name: "Analytics" }).click();

    const section = page.getByTestId("conversions-section");
    await expect(section).toBeVisible();
    await expect(page.getByTestId("conversions-leads")).toHaveText("1");
    await expect(page.getByTestId("conversions-sales")).toHaveText("0");

    const bySender = page.getByTestId("conversions-by-sender");
    const senderRow = bySender.getByTestId("conversion-row").filter({ hasText: seeded.senderId });
    await expect(senderRow).toBeVisible();
    await expect(senderRow.locator("td").nth(2)).toHaveText("1");
    await expect(senderRow.locator("td").nth(3)).toHaveText("100.00%");

    const byText = page.getByTestId("conversions-by-text");
    const textRow = byText.getByTestId("conversion-row").filter({ hasText: seeded.adText });
    await expect(textRow).toBeVisible();
    await expect(textRow.locator("td").nth(2)).toHaveText("1");
  });

  test("the postback settings page shows the signed URL for the organisation", async ({ page }) => {
    await page.goto("/settings/postbacks");
    await expect(page.getByRole("heading", { level: 1, name: "Postbacks" })).toBeVisible();
    await expect(
      page.getByText("/postback/external?dynamic_id={{dynamic}}&type=lead"),
    ).toBeVisible();
    await expect(page.getByTestId("rotate-secret")).toBeVisible();
  });
});
