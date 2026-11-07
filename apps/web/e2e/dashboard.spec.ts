import { expect, test } from "@playwright/test";
import { cleanupE2eResults, type SeededResults, seedE2eResults } from "./helpers/db";

const PREFIX = "E2E Dashboard";
const SEPT = "range=custom&from=2026-09-01&to=2026-09-30";

/**
 * The dashboard tabs (D4-05) over the seeded results campaign (eleven messages on 14 Sep
 * 2026, nine accepted, three clicked, one lead, one sale on its laps): the filters live in
 * the URL, each tab renders its cards and charts, chart tables toggle, the ROI pivot drills
 * down, and the Contacts threshold recalculates.
 */
test.describe("dashboard", () => {
  test.describe.configure({ mode: "serial" });
  let seeded: SeededResults;

  test.beforeAll(async () => {
    await cleanupE2eResults(PREFIX);
    seeded = await seedE2eResults(PREFIX);
  });

  test.afterAll(async () => {
    await cleanupE2eResults(PREFIX);
  });

  test("tabs and filters live in the URL; Overview charts have table twins", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "SMS Dashboard" })).toBeVisible();
    await expect(page.getByTestId("getting-started")).toBeVisible();

    await page.getByRole("tab", { name: "Overview" }).click();
    await expect(page).toHaveURL(/tab=overview/);
    await expect(page.getByTestId("overview-tab")).toBeVisible();
    await page.getByTestId("range-30d").click();
    await expect(page).toHaveURL(/range=30d/);

    await page.goto(`/?tab=overview&${SEPT}`);
    const sent = Number(
      ((await page.getByTestId("kpi-sent").textContent()) ?? "0").replace(/k$/, "000"),
    );
    expect(sent).toBeGreaterThanOrEqual(9);
    const chart = page.getByTestId("chart-sms-sent");
    await chart.getByTestId("chart-table-toggle").click();
    await expect(chart.getByTestId("chart-table")).toContainText("Sep 2026");
    await chart.getByTestId("grain-week").click();
    await expect(chart.getByTestId("chart-table")).toContainText("14 Sep");
  });

  test("the ROI pivot drills from country to link to list and totals", async ({ page }) => {
    await page.goto(`/?tab=roi&${SEPT}&country=ES`);
    const table = page.getByTestId("roi-table");
    await expect(table.getByTestId("roi-total")).toBeVisible();
    await expect(page.getByTestId("roi-chip-country")).toBeVisible();
    await page.getByTestId("roi-expand").click();
    const rows = table.getByTestId("roi-row");
    await expect(rows.filter({ hasText: `${PREFIX} link` })).toHaveCount(1);
    await expect(rows.filter({ hasText: "Roy Boy_ES" }).first()).toBeVisible();
    await expect(table.getByTestId("roi-total")).toContainText("€");

    // Removing every dimension leaves the total alone; adding Date brings months back.
    await page.getByRole("button", { name: "Remove country" }).click();
    await page.getByRole("button", { name: "Remove link" }).click();
    await page.getByRole("button", { name: "Remove list" }).click();
    await expect(rows).toHaveCount(0);
    await page.getByTestId("roi-add-date").click();
    await expect(rows.first()).toContainText("2026-09");
  });

  test("Countries, Contacts, Assets and API Usage render their cards", async ({ page }) => {
    await page.goto(`/?tab=countries&${SEPT}`);
    const es = page.locator('[data-testid="country-row"][data-country="ES"]');
    await expect(es).toBeVisible();
    await expect(es.locator("[data-status]")).toBeVisible();
    await expect(page.getByTestId("insight-opportunity")).toBeVisible();

    await page.goto("/?tab=contacts&threshold=1");
    await expect(page.getByTestId("lists-card")).toBeVisible();
    await expect(page.getByTestId("chart-pool")).toBeVisible();
    await expect(page.getByTestId("under-sent")).toContainText("Sent < 1 times");
    await page.getByTestId("threshold-input").fill("2");
    await page.getByTestId("threshold-input").press("Enter");
    await expect(page).toHaveURL(/threshold=2/);
    await expect(page.getByTestId("under-sent")).toContainText("Sent < 2 times");

    await page.goto(`/?tab=assets&${SEPT}`);
    await expect(page.getByTestId("assets-table").getByTestId("asset-row").first()).toBeVisible();
    await page.getByRole("tab", { name: "Sender IDs" }).click();
    await expect(page).toHaveURL(/asset=sids/);
    await expect(
      page.getByTestId("assets-table").getByTestId("asset-row").filter({ hasText: "E2ESID" }),
    ).toHaveCount(1);
    await page.getByTestId("asset-search").fill("nomatch-zzz");
    await page.getByTestId("asset-search").press("Enter");
    await expect(page).toHaveURL(/q=nomatch-zzz/);
    await expect(page.getByTestId("assets-table")).toContainText("Nothing sent yet");

    await page.goto("/?tab=api");
    await expect(page.getByTestId("api-usage-tab")).toBeVisible();
    await expect(page.getByTestId("api-kpi-sent")).toBeVisible();
    expect(seeded.campaignId).toBeTruthy();
  });
});
