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
    // One Filters button only; Search applies on Enter and Export sits outside the filter row.
    await expect(page.getByRole("button", { name: "Filter", exact: true })).toHaveCount(0);
    await expect(page.getByTestId("export-csv")).toBeVisible();
    await page.getByLabel("Search").fill(PREFIX);
    await page.getByLabel("Search").press("Enter");
    await expect(page).toHaveURL(/search=/);
    await expect(page.getByTestId("campaign-row")).toHaveCount(2);
    // The filter row is behind the Filters toggle until a filter is set. Retry the click:
    // right after navigation the button may not be hydrated yet.
    const filtersButton = page.getByRole("button", { name: "Filters", exact: true });
    await expect(async () => {
      await filtersButton.click();
      await expect(filtersButton).toHaveAttribute("aria-pressed", "true");
    }).toPass();

    await page.getByLabel("Has sales").check();
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(page).toHaveURL(/hasSales=1/);
    const rows = page.getByTestId("campaign-row");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(seeded.campaignName);
    await expect(rows.first().locator("td").nth(10)).toHaveText(String(seeded.sql.sales));
    await expect(page.getByTestId("campaign-count")).toHaveText("1 campaign");

    // No clicks: only the draft.
    await page.getByLabel("Has sales").uncheck();
    await page.getByLabel("No clicks").check();
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(page.getByTestId("campaign-row")).toHaveCount(1);
    await expect(page.getByTestId("campaign-row").first()).toContainText(draftName);

    // Spend above EUR 0.20: only the seeded campaign (EUR 0.225).
    await page.getByLabel("No clicks").uncheck();
    await page.getByLabel("Spend above (EUR)").fill("0.20");
    await page.getByRole("button", { name: "Apply", exact: true }).click();
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

    // Countries is a searchable multi-select and Date Range a presets popover; both land in the URL.
    await page.getByLabel("Spend above (EUR)").fill("");
    // Radix popovers need the hydrated client; retry the open like the Filters toggle above.
    const countriesButton = page.getByRole("button", { name: /All countries/ });
    await expect(async () => {
      await countriesButton.click();
      await expect(page.getByPlaceholder("Search countries…")).toBeVisible({ timeout: 2_000 });
    }).toPass();
    await page.getByPlaceholder("Search countries…").fill("Spain");
    await page
      .locator("label", { hasText: /Spain$/ })
      .first()
      .click();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Date Range" }).click();
    await page.getByRole("button", { name: "Last 90 Days" }).click();
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(page).toHaveURL(/country=ES/);
    await expect(page).toHaveURL(/from=\d{4}-\d{2}-\d{2}/);
    await expect(page.getByTestId("campaign-row")).toHaveCount(2);
    await expect(page.getByRole("button", { name: /Spain/ })).toBeVisible();
  });

  test("duplicate from the actions menu opens a copy with the same settings", async ({ page }) => {
    await page.goto(`/campaigns?search=${encodeURIComponent(PREFIX)}&hasSales=1`);
    const row = page.getByTestId("campaign-row").filter({ hasText: seeded.campaignName });
    await row.getByRole("button", { name: `Duplicate ${seeded.campaignName}` }).click();

    await expect(page).toHaveURL(/\/campaigns\/[0-9a-f-]{36}$/);
    expect(page.url()).not.toContain(seeded.campaignId);
    await expect(page.getByTestId("campaign-name")).toHaveText(`Copy of ${seeded.campaignName}`);
    await expect(page.getByTestId("sending-progress")).toContainText("0 /");
    await page.getByRole("button", { name: "Lists", exact: true }).click();
    await expect(
      page.getByTestId("lists-panel").getByLabel("Roy Boy_ES_14092026_Batch2", { exact: true }),
    ).toBeChecked();
    await expect(page.getByTestId("sid-group-select")).toContainText("ES Casino");
    await page.getByRole("button", { name: "Ad Texts", exact: true }).click();
    await expect(page.getByTestId("ad-text-row")).toHaveCount(1);
    await expect(page.getByTestId("ad-text-row")).toContainText("E2E results text");
    await page.getByRole("button", { name: "Offers", exact: true }).click();
    await expect(page.getByText(`${PREFIX} link`)).toBeVisible();
    await expect(page.getByTestId("lap-row")).toHaveCount(0);
  });
});
