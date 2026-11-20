import { expect, test } from "@playwright/test";
import { ensureDemoActivity, setDemoPreview, setDemoPreviewToggle } from "./helpers/demo";

/**
 * The Existing / New switch (D5-11): an organisation offered the switch starts on Existing (the
 * app without the Performance screens), New shows them with the organisation's own numbers, and
 * Existing hides them again. An organisation with the preview on gets no switch.
 */
test.describe("Existing / New switch", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(() => {
    ensureDemoActivity();
  });

  // Leave the demo organisation as the other specs expect it: preview on, no switch.
  test.afterAll(async () => {
    await setDemoPreviewToggle(false);
    await setDemoPreview(true);
  });

  test("starts on Existing, New shows Performance, Existing hides it again", async ({ page }) => {
    await setDemoPreview(false);
    await setDemoPreviewToggle(true);

    await page.goto("/");
    const toggle = page.getByTestId("view-toggle");
    await expect(toggle.getByRole("button", { name: "Existing" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const nav = page.getByRole("navigation", { name: "Main" });
    await nav.hover();
    await expect(nav.getByRole("button", { name: "Campaigns", exact: true })).toBeVisible();
    await expect(nav.getByRole("button", { name: "Performance", exact: true })).toHaveCount(0);
    await page.goto("/kpi/insight");
    await expect(page.getByText("This page could not be found.")).toBeVisible();

    await page.goto("/");
    await page.getByTestId("view-toggle").getByRole("button", { name: "New" }).click();
    await expect(
      page.getByTestId("view-toggle").getByRole("button", { name: "New" }),
    ).toHaveAttribute("aria-pressed", "true");
    await nav.hover();
    await nav.getByRole("button", { name: "Performance", exact: true }).click();
    await nav.getByRole("link", { name: "List Follow-Up", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "List Follow-Up" })).toBeVisible();

    // The choice stays after a reload.
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "List Follow-Up" })).toBeVisible();

    // Back to Existing from a Performance page: home page, no Performance menu.
    await page.getByTestId("view-toggle").getByRole("button", { name: "Existing" }).click();
    await expect(page).toHaveURL(/\/$/);
    await nav.hover();
    await expect(nav.getByRole("button", { name: "Performance", exact: true })).toHaveCount(0);
  });

  test("an organisation with the preview on gets no switch", async ({ page }) => {
    await setDemoPreview(true);
    await setDemoPreviewToggle(true);
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Main" });
    await nav.hover();
    await expect(nav.getByRole("button", { name: "Performance", exact: true })).toBeVisible();
    await expect(page.getByTestId("view-toggle")).toHaveCount(0);
  });
});
