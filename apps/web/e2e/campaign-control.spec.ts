import { expect, type Page, test } from "@playwright/test";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { cleanupE2eControlCampaigns, seedE2eControlCampaign } from "./helpers/db";

/**
 * Pause, resume, stop and (re)schedule a campaign as the seeded development owner (D2-08,
 * D2-09). The campaigns are seeded directly with one queued lap; the worker is not running,
 * so what is checked is the web side: status badges, lap rows, the schedule editor, the
 * Scheduled view and the audit rows on the Logs tab.
 */
const PREFIX = "E2E control";
const TZ = "Europe/Madrid";

function headerStatus(page: Page) {
  return page.locator("header span[data-status]").first();
}

async function logActions(page: Page): Promise<string[]> {
  await page.getByRole("tab", { name: "Logs" }).click();
  const rows = page.getByTestId("logs-table").locator("tbody tr td:nth-child(2)");
  await expect(rows.first()).toBeVisible();
  return rows.allTextContents();
}

test.describe("campaign control", () => {
  test.afterAll(() => cleanupE2eControlCampaigns(PREFIX));

  test("pause, resume and stop a sending campaign", async ({ page }) => {
    const seeded = await seedE2eControlCampaign(PREFIX, { status: "sending" });
    await page.goto(`/campaigns/${seeded.campaignId}`);
    await expect(page.getByTestId("campaign-name")).toHaveText(seeded.campaignName);
    await expect(headerStatus(page)).toHaveAttribute("data-status", "sending");

    await page.getByTestId("campaign-pause").click();
    await expect(headerStatus(page)).toHaveAttribute("data-status", "paused");
    await expect(page.getByTestId("campaign-pause")).toBeHidden();

    await page.getByTestId("campaign-resume").click();
    await expect(headerStatus(page)).toHaveAttribute("data-status", "sending");
    await expect(page.getByTestId("lap-row").first()).toHaveAttribute("data-lap-status", "queued");

    // Stop asks for confirmation and cancels the queued lap.
    await page.getByTestId("campaign-stop").click();
    const dialog = page.getByRole("dialog", { name: "Stop campaign" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("10 contacts");
    await dialog.getByTestId("confirm-stop").click();
    await expect(headerStatus(page)).toHaveAttribute("data-status", "stopped");
    await expect(page.getByTestId("lap-row").first()).toHaveAttribute(
      "data-lap-status",
      "cancelled",
    );
    await expect(page.getByTestId("campaign-controls")).toBeHidden();

    const actions = await logActions(page);
    expect(actions).toEqual(["campaign.stop", "campaign.resume", "campaign.pause"]);
  });

  test("change and cancel the schedule of a scheduled campaign", async ({ page }) => {
    const twoDays = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    const day = formatInTimeZone(twoDays, TZ, "yyyy-MM-dd");
    const scheduledAt = fromZonedTime(`${day}T10:00:00`, TZ);
    const seeded = await seedE2eControlCampaign(PREFIX, { status: "scheduled", scheduledAt });

    // The Scheduled view lists it under its Madrid day at 10:00.
    await page.goto("/campaigns/scheduled");
    await expect(page.getByRole("heading", { level: 1, name: "Scheduled sends" })).toBeVisible();
    const row = page.getByTestId("scheduled-row").filter({ hasText: seeded.campaignName });
    await expect(row).toBeVisible();
    await expect(row).toContainText("10:00");
    await expect(row).toContainText(TZ);
    await expect(page.locator(`[data-testid="scheduled-day"][data-day="${day}"]`)).toContainText(
      seeded.campaignName,
    );

    // The campaign page shows the editor with the same local time.
    await page.goto(`/campaigns/${seeded.campaignId}`);
    await expect(headerStatus(page)).toHaveAttribute("data-status", "scheduled");
    const editor = page.getByTestId("schedule-editor");
    await expect(editor).toBeVisible();
    await expect(page.getByTestId("scheduled-for")).toContainText("10:00");

    // Move it a day later at 11:45 (entered as Madrid wall-clock time).
    const threeDays = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const newDay = formatInTimeZone(threeDays, TZ, "yyyy-MM-dd");
    await page.getByTestId("schedule-time").fill(`${newDay}T11:45`);
    await page.getByTestId("save-schedule").click();
    await expect(page.getByTestId("scheduled-for")).toContainText("11:45");
    await expect(headerStatus(page)).toHaveAttribute("data-status", "scheduled");
    await expect(page.getByTestId("lap-row").first()).toHaveAttribute("data-lap-status", "queued");

    // Cancel the schedule: back to draft, the queued lap is cancelled, the editor goes away.
    await page.getByTestId("cancel-schedule").click();
    const dialog = page.getByRole("dialog", { name: "Cancel schedule" });
    await expect(dialog).toBeVisible();
    await dialog.getByTestId("confirm-cancel-schedule").click();
    await expect(headerStatus(page)).toHaveAttribute("data-status", "draft");
    await expect(page.getByTestId("lap-row").first()).toHaveAttribute(
      "data-lap-status",
      "cancelled",
    );
    await expect(page.getByTestId("schedule-editor")).toBeHidden();

    const actions = await logActions(page);
    expect(actions).toEqual(["campaign.schedule_cancel", "campaign.reschedule"]);

    // Gone from the Scheduled view.
    await page.goto("/campaigns/scheduled");
    await expect(
      page.getByTestId("scheduled-row").filter({ hasText: seeded.campaignName }),
    ).toHaveCount(0);
  });
});
