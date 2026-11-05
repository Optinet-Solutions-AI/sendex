import { expect, test } from "@playwright/test";
import { cleanupE2eAlerts, seedE2eAlert } from "./helpers/db";

/**
 * Daily caps and alerts (D3-11) as the seeded development owner. The worker is not running
 * under Playwright, so the alert row the banner shows is inserted through the e2e db helper
 * the way `raiseAlert` would store it; acknowledging it goes through the real server action.
 */

test.describe("caps and alerts", () => {
  test.afterAll(async () => {
    await cleanupE2eAlerts();
  });

  test("the owner sets a cap of one message, sees an alert in the banner and acknowledges it", async ({
    page,
  }) => {
    await page.goto("/settings/billing");
    await expect(page.getByRole("heading", { level: 1, name: "Billing settings" })).toBeVisible();
    await expect(page.getByTestId("caps-explainer")).toContainText("midnight UTC");
    await page.getByLabel("Messages per day").fill("1");
    await page.getByTestId("save-billing-settings").click();
    await expect(page.getByTestId("toast")).toContainText("Billing settings saved");

    // The worker would raise this once the cap refused a lap; seed the row it would write.
    const seeded = await seedE2eAlert({
      kind: "daily_message_cap",
      message: `Daily message cap of 1 reached: 599 messages refused. [e2e ${Date.now()}]`,
    });

    await page.goto("/");
    const banner = page.getByTestId("alerts-banner");
    await expect(banner).toBeVisible();
    const row = banner.getByTestId("alert-row").filter({ hasText: seeded.message });
    await expect(row).toBeVisible();
    await expect(row).toContainText("Daily message cap");
    await expect(row.getByRole("link", { name: "Raise the cap" })).toHaveAttribute(
      "href",
      "/settings/billing",
    );

    await row.getByTestId("acknowledge-alert").click();
    await expect(page.getByTestId("toast")).toContainText("Alert acknowledged");
    await expect(page.getByTestId("alert-row").filter({ hasText: seeded.message })).toHaveCount(0);

    // Audited, with the actor.
    await page.goto("/audit?action=alert.acknowledge");
    const auditRow = page
      .getByRole("row", { name: new RegExp(`periodKey=${seeded.periodKey}`) })
      .first();
    await expect(auditRow).toBeVisible();
    await expect(auditRow).toContainText("Development user");

    // Leave the seeded organisation without a cap again.
    await page.goto("/settings/billing");
    await page.getByLabel("Messages per day").fill("");
    await page.getByTestId("save-billing-settings").click();
    await expect(page.getByTestId("toast")).toContainText("Billing settings saved");
  });
});
