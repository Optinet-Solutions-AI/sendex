import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { cleanupE2eBrandDeals, seedE2eOffer } from "./helpers/db";

const OFFER = "E2E Deals Brand Gamma UK";
const EXAMPLE = join(
  __dirname,
  "..",
  "..",
  "..",
  "docs",
  "public",
  "examples",
  "brand-deals-example.csv",
);

/**
 * D5-16: the Media Deals export is uploaded in Settings › Brand deals; each brand gets its
 * euro CPA (or is listed without a price, with why), and an offer is given the deal it earns
 * from, suggested by its name.
 */
test.describe("brand deals", () => {
  test.describe.configure({ mode: "serial" });

  const cleanup = () => cleanupE2eBrandDeals("E2E Deals");
  test.beforeAll(async () => {
    await cleanup();
    await seedE2eOffer(OFFER);
  });
  test.afterAll(cleanup);

  test("upload the example export, then give an offer its brand's deal", async ({ page }) => {
    await page.goto("/settings/brand-deals");
    await expect(page.getByRole("heading", { level: 1, name: "Brand deals" })).toBeVisible();

    await page.getByLabel("File").setInputFiles(EXAMPLE);
    await page.getByLabel("Prices apply from").fill("2026-11-20");
    await page.getByRole("button", { name: "Upload" }).click();
    await expect(page.getByTestId("deals-upload-summary")).toContainText(
      "5 deals saved, 3 with a euro CPA.",
    );

    const table = page.getByTestId("brand-deals-table");
    const alpha = table.getByRole("row", { name: /Brand Alpha/ });
    await expect(alpha).toContainText("€200.00");
    await expect(alpha).toContainText("2026-11-01");
    await expect(table.getByRole("row", { name: /Brand Gamma/ })).toContainText("2026-10-15");
    await expect(table.getByRole("row", { name: /Brand Delta/ })).toContainText(
      "No CPA in the deal",
    );
    await expect(table.getByRole("row", { name: /Brand Epsilon/ })).toContainText(
      "CPA not in euros",
    );
    await expect(page.getByText("PASS")).toHaveCount(0);

    const offers = page.getByTestId("offer-deals");
    const offer = offers.getByRole("listitem").filter({ hasText: OFFER });
    await expect(offer).toContainText("No revenue");
    await offer.getByRole("button", { name: "Use Brand Gamma?" }).click();
    const select = page.getByLabel(`Deal for ${OFFER}`);
    await expect(select).toHaveValue("sample partners|brand gamma");
    await expect(offer).not.toContainText("No revenue");

    await page.reload();
    await expect(page.getByLabel(`Deal for ${OFFER}`)).toHaveValue("sample partners|brand gamma");
  });
});
