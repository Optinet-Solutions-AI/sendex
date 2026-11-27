import { expect, test } from "@playwright/test";
import { cleanupE2eBrandDeals, seedE2eOffer } from "./helpers/db";

const PREFIX = "E2E Deals";
const OFFER = `${PREFIX} Brand A UK`;

/**
 * D5-23: a deal is added in Settings › Brand deals with the Scaleo offer it is sold through;
 * an offer whose link points to that Scaleo offer earns it by itself.
 */
test.describe("brand deals", () => {
  test.describe.configure({ mode: "serial" });
  const cleanup = () => cleanupE2eBrandDeals(PREFIX);
  test.beforeAll(async () => {
    await cleanup();
    await seedE2eOffer(
      OFFER,
      "https://example.scaletrk.com/click?o=978123&a=42&sub_id1={{dynamic}}",
    );
  });
  test.afterAll(cleanup);

  test("add a deal for a Scaleo offer; the offer using it gets it by itself", async ({ page }) => {
    await page.goto("/settings/brand-deals");
    await expect(page.getByRole("heading", { level: 1, name: "Brand deals" })).toBeVisible();

    await page.getByLabel("Program").fill(`${PREFIX} Example Partners`);
    await page.getByLabel("Brand", { exact: true }).fill("Brand A SMS");
    await page.getByLabel("Scaleo offer id").fill("978123");
    await page.getByLabel("CPA (€)").fill("150");
    await page.getByLabel("From").fill("2026-11-01");
    await page.getByRole("button", { name: "Save deal" }).click();
    await expect(page.getByTestId("deal-notice")).toContainText("1 offer(s) now earn it.");

    const row = page.getByTestId("brand-deals-table").getByRole("row", { name: /Brand A SMS/ });
    await expect(row).toContainText("€150.00");
    await expect(row).toContainText("978123");
    await expect(row).toContainText("2026-11-01");

    await page.reload();
    await expect(page.getByLabel(`Deal for ${OFFER}`)).toHaveValue("scaleo:978123");
  });
});
