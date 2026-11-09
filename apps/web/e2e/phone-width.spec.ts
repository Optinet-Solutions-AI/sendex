import { expect, type Locator, type Page, test } from "@playwright/test";

/**
 * At phone width (400 px) the page itself never scrolls sideways: wide tables scroll inside
 * their own box, and the header title and buttons stay on screen. QA round two found the
 * Dashboard header clipped (Z15); this walks the screens that overflowed.
 */
test.describe("phone width", () => {
  test.use({ viewport: { width: 400, height: 800 } });

  async function expectNoSidewaysScroll(page: Page) {
    const widths = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(widths.scroll, "page wider than the screen").toBeLessThanOrEqual(widths.client);
  }

  /** Left and right edges on screen; how far down the page it sits does not matter. */
  async function expectAcrossScreen(page: Page, locator: Locator) {
    await expect(locator).toBeVisible();
    const box = await locator.boundingBox();
    if (!box) throw new Error("no box for the element");
    const width = page.viewportSize()?.width ?? 0;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
  }

  for (const path of [
    "/",
    "/?tab=roi",
    "/lists",
    "/lists/upload",
    "/campaigns",
    "/segments",
    "/unsubscribes",
    "/enrichment",
    "/routes/platform",
    "/routes/testing",
    "/reports/postbacks",
    "/settings/api-tokens",
    "/audit",
  ]) {
    test(`${path} fits the screen`, async ({ page }) => {
      await page.goto(path);
      await expectAcrossScreen(page, page.getByRole("heading", { level: 1 }));
      await expectNoSidewaysScroll(page);
    });
  }

  test("the Dashboard header buttons are on screen", async ({ page }) => {
    await page.goto("/");
    await expectAcrossScreen(page, page.getByRole("link", { name: "Upload Contacts" }));
    await expectAcrossScreen(page, page.getByTestId("new-campaign"));
  });

  test("a campaign page fits the screen", async ({ page }) => {
    await page.goto("/campaigns");
    await page.getByTestId("campaign-row").first().getByRole("link").first().click();
    await expect(page).toHaveURL(/\/campaigns\/[0-9a-f-]{36}/);
    await expectAcrossScreen(page, page.getByRole("heading", { level: 1 }));
    await expectNoSidewaysScroll(page);
  });
});
