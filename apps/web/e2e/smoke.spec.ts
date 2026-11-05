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

  test("the home response carries the security headers and the page loads clean under the CSP", async ({
    page,
  }) => {
    const violations: string[] = [];
    page.on("console", (message) => {
      if (message.text().includes("Content Security Policy")) violations.push(message.text());
    });

    const response = await page.goto("/");
    if (!response) throw new Error("no response for /");
    const headers = response.headers();

    const csp = headers["content-security-policy"] ?? "";
    expect(csp).toContain("default-src 'self'");
    expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    // The dev server is plain http; HSTS only comes with production builds.
    expect(headers["strict-transport-security"]).toBeUndefined();

    // The nonce reached Next: its own inline scripts carry it, so none is blocked.
    await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
    const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
    expect(nonce).toBeTruthy();
    expect(await page.locator(`script[nonce]`).count()).toBeGreaterThan(0);
    expect(violations).toEqual([]);
  });
});
