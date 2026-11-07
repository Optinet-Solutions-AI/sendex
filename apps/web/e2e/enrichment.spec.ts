import { expect, test } from "@playwright/test";
import { cleanupE2eEnrichment } from "./helpers/db";

/**
 * Contacts › Enrichment (D4-07): the KPI strip, an enrichment rule for Malta created from
 * the inline form and removed again, the coverage card, and HLR Verify on a list queuing a
 * request that the verification log then lists.
 */
test.describe("numbers verification", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    await cleanupE2eEnrichment();
  });

  test.afterAll(async () => {
    await cleanupE2eEnrichment();
  });

  test("the page shows the KPIs, creates and removes a rule, and knows the coverage", async ({
    page,
  }) => {
    await page.goto("/enrichment");
    await expect(
      page.getByRole("heading", { level: 1, name: "Numbers Verification" }),
    ).toBeVisible();
    const total = Number(
      ((await page.getByTestId("kpi-total").textContent()) ?? "0").replace(/,/g, ""),
    );
    expect(total).toBeGreaterThan(0);
    await expect(
      page.getByTestId("rules-empty").or(page.getByTestId("rule-row").first()),
    ).toBeVisible();

    await page.getByTestId("add-rule").click();
    await expect(page.getByTestId("rule-create")).toBeDisabled();
    await page.getByTestId("rule-country").selectOption("MT");
    await page.getByTestId("rule-daily").fill("100");
    await page.getByTestId("rule-budget").fill("2");
    await page.getByTestId("rule-after-upload").check();
    await page.getByTestId("rule-create").click();
    await expect(page.getByTestId("toast").last()).toContainText("Rule created");
    const row = page.locator('[data-testid="rule-row"][data-country="MT"]');
    await expect(row).toBeVisible();
    await expect(row).toContainText("100/day");
    await expect(row).toContainText("€2.00/month");
    await expect(row).toContainText("after an upload");

    await page.getByTestId("coverage-country").selectOption("MT");
    await expect(page.getByTestId("coverage-row")).toContainText("HLR 210");
    await expect(page.getByTestId("coverage-row")).toContainText("€0.0050");

    await row.getByTestId("rule-remove").click();
    await expect(row).toHaveCount(0);
  });

  test("HLR Verify on a list queues a request that the log lists", async ({ page }) => {
    await page.goto("/lists");
    await page
      .getByRole("link", { name: /Roy Boy_ES/ })
      .first()
      .click();
    await page.getByRole("tab", { name: "Lookup" }).click();
    await expect(page.getByTestId("lookup-table")).toBeVisible();
    await page.getByTestId("hlr-verify").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText(/unverified number/);
    await expect(dialog).toContainText("€0.0040");
    await dialog.getByRole("button", { name: "Verify" }).click();
    await expect(page.getByTestId("toast").last()).toContainText("Verification queued");

    await page.goto("/enrichment?range=all");
    const log = page
      .getByTestId("verification-log")
      .getByTestId("log-row")
      .filter({ hasText: "Spain" });
    await expect(log.first()).toBeVisible();
    const csv = await page.request.get("/enrichment/export?range=all&country=ES");
    expect(csv.ok()).toBe(true);
    expect(await csv.text()).toContain("Date,Country,Total,Good,Bad,No verdict");
  });
});
