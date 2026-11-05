import { expect, test } from "@playwright/test";
import { cleanupE2eResults, type SeededResults, seedE2eResults } from "./helpers/db";

const PREFIX = "E2E List";

/**
 * The campaigns list (D3-06) as the seeded development owner: the sales filter keeps only
 * campaigns with sales, the CSV export carries the same filter, and Duplicate from the
 * actions menu opens a copy with the same lists, sender id group, texts and links.
 */
test.describe("campaigns list", () => {
  test.describe.configure({ mode: "serial" });
  let seeded: SeededResults;
  const draftName = `${PREFIX} draft ${Date.now()}`;

  test.beforeAll(async () => {
    await cleanupE2eResults(PREFIX);
    seeded = await seedE2eResults(PREFIX);
  });

  test.afterAll(async () => {
    await cleanupE2eResults(PREFIX);
  });

  test("the sales filter shows only campaigns with sales and the export matches", async ({
    page,
    request,
  }) => {
    // A draft without any sending, to be filtered out.
    await page.goto("/campaigns");
    await page.getByTestId("new-campaign").click();
    const dialog = page.getByRole("dialog", { name: "New Campaign" });
    await dialog.getByLabel("Name").fill(draftName);
    await dialog.getByLabel("Country").selectOption("ES");
    await dialog.getByRole("button", { name: "Create campaign" }).click();
    await expect(page).toHaveURL(/\/campaigns\/[0-9a-f-]{36}$/);

    await page.goto("/campaigns");
    await page.getByLabel("Search").fill(PREFIX);
    await page.getByRole("button", { name: "Filter" }).click();
    await expect(page.getByTestId("campaign-row")).toHaveCount(2);

    await page.getByLabel("Has sales").check();
    await page.getByRole("button", { name: "Filter" }).click();
    await expect(page).toHaveURL(/hasSales=1/);
    const rows = page.getByTestId("campaign-row");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(seeded.campaignName);
    await expect(rows.first().locator("td").nth(10)).toHaveText(String(seeded.sql.sales));
    await expect(page.getByTestId("campaign-count")).toHaveText("1 campaign");

    // No clicks: only the draft.
    await page.getByLabel("Has sales").uncheck();
    await page.getByLabel("No clicks").check();
    await page.getByRole("button", { name: "Filter" }).click();
    await expect(page.getByTestId("campaign-row")).toHaveCount(1);
    await expect(page.getByTestId("campaign-row").first()).toContainText(draftName);

    // Spend above EUR 0.20: only the seeded campaign (EUR 0.225).
    await page.getByLabel("No clicks").uncheck();
    await page.getByLabel("Spend above (EUR)").fill("0.20");
    await page.getByRole("button", { name: "Filter" }).click();
    await expect(page.getByTestId("campaign-row")).toHaveCount(1);
    await expect(page.getByTestId("campaign-row").first()).toContainText(seeded.campaignName);

    const exportHref = await page.getByTestId("export-csv").getAttribute("href");
    expect(exportHref).toContain("spendMin=0.20");
    const csv = await request.get(
      `/campaigns/export?search=${encodeURIComponent(PREFIX)}&hasSales=1`,
    );
    expect(csv.ok()).toBe(true);
    expect(csv.headers()["content-type"]).toContain("text/csv");
    expect(csv.headers()["content-disposition"]).toContain("campaigns-");
    const body = await csv.text();
    const lines = body.trim().split("\r\n");
    expect(lines[0]).toBe(
      "Id,Campaign,Status,Country,Laps,Sent,Clicks,CTR,Cost (EUR),Leads,Sales,First send,Last send",
    );
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain(seeded.campaignName);
    expect(lines[1]).toContain(",sending,ES,2,9,4,44.44%,0.23,1,1,");
    expect(body).not.toContain(draftName);
  });

  test("duplicate from the actions menu opens a copy with the same settings", async ({ page }) => {
    await page.goto(`/campaigns?search=${encodeURIComponent(PREFIX)}&hasSales=1`);
    const row = page.getByTestId("campaign-row").filter({ hasText: seeded.campaignName });
    await row.locator("summary").click();
    await row.getByRole("button", { name: `Duplicate ${seeded.campaignName}` }).click();

    await expect(page).toHaveURL(/\/campaigns\/[0-9a-f-]{36}$/);
    expect(page.url()).not.toContain(seeded.campaignId);
    await expect(page.getByTestId("campaign-name")).toHaveText(`Copy of ${seeded.campaignName}`);
    await expect(page.getByTestId("sending-progress")).toContainText("0 /");
    await expect(
      page.getByTestId("lists-panel").getByLabel("Roy Boy_ES_14092026_Batch2"),
    ).toBeChecked();
    await expect(page.getByTestId("sid-group-select")).toContainText("ES Casino");
    await expect(page.getByTestId("ad-text-row")).toHaveCount(1);
    await expect(page.getByTestId("ad-text-row")).toContainText("E2E results text");
    await expect(page.getByText(`${PREFIX} link`)).toBeVisible();
    await expect(page.getByTestId("lap-row")).toHaveCount(0);
  });
});
