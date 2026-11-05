import { expect, test } from "@playwright/test";
import { cleanupE2eApiTokens } from "./helpers/db";

const PREFIX = "E2E token";

/**
 * Settings → API tokens as the seeded development owner (`SENDEX_DEV_AUTH=1`): create a
 * token, see it exactly once, revoke it. The worker is not running under Playwright; that
 * the token then answers 401 is covered by apps/worker/src/public-api/routes.test.ts.
 */
test.describe("api tokens", () => {
  test.beforeAll(async () => {
    await cleanupE2eApiTokens(PREFIX);
  });

  test.afterAll(async () => {
    await cleanupE2eApiTokens(PREFIX);
  });

  test("create → one-time reveal → revoke", async ({ page }) => {
    await page.goto("/settings");
    await page.getByRole("link", { name: "API tokens" }).click();
    await expect(page).toHaveURL(/\/settings\/api-tokens$/);
    await expect(page.getByRole("heading", { level: 1, name: "API tokens" })).toBeVisible();

    const name = `${PREFIX} ${Date.now()}`;
    await page.getByLabel("Name").fill(name);
    // read is on by default; add send.
    await page.getByRole("checkbox", { name: /send/ }).click();
    await page.getByTestId("create-token").click();

    const reveal = page.getByTestId("token-reveal");
    await expect(reveal).toBeVisible();
    const token = (await reveal.textContent()) ?? "";
    expect(token).toMatch(/^sdx_[A-Za-z0-9_-]{43}$/);
    await page.getByTestId("token-reveal-done").click();
    await expect(reveal).toHaveCount(0);

    // Listed with its display prefix only, active, with the chosen scopes.
    const row = page.getByRole("row", { name: new RegExp(name) });
    await expect(row).toBeVisible();
    await expect(row).toContainText(`${token.slice(0, 12)}…`);
    await expect(row).not.toContainText(token);
    await expect(row).toContainText("read, send");
    await expect(row.getByText("Active")).toBeVisible();

    await row.getByRole("button", { name: "Revoke" }).click();
    await page.getByRole("button", { name: "Revoke token" }).click();
    await expect(page.getByTestId("toast")).toContainText("Token revoked");
    await expect(row.getByText("Revoked")).toBeVisible();
    await expect(row.getByRole("button", { name: "Revoke" })).toHaveCount(0);
  });
});
