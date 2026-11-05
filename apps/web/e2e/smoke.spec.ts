import { expect, test } from "@playwright/test";

const NAV_LABELS = ["Dashboard", "Campaigns", "Lists", "Settings"] as const;

test.describe("dashboard shell under the development auth stub", () => {
  test("the home page shows the nav and the development login banner", async ({ page }) => {
    await page.goto("/");

    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav).toBeVisible();
    for (const label of NAV_LABELS) {
      await expect(nav.getByRole("link", { name: label, exact: true })).toBeVisible();
    }

    const banner = page.getByTestId("dev-auth-banner");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("Development login: external as owner");

    await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
    await expect(page.getByText("Your role")).toBeVisible();
  });

  test("the settings page renders for the seeded owner", async ({ page }) => {
    await page.goto("/settings");

    await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
    await expect(page.getByText("Your role is owner")).toBeVisible();
    await expect(page.getByTestId("dev-auth-banner")).toBeVisible();
  });

  test("the Clerk sign-in page redirects to the dashboard", async ({ page }) => {
    await page.goto("/sign-in");

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
  });
});
