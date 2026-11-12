import { expect, test } from "@playwright/test";
import { cleanupE2eControlCampaigns, resetE2eSendingHours } from "./helpers/db";

const PREFIX = "E2E Hours";

/**
 * D4-14: suggested sending hours are entered in Settings; a campaign sent outside them shows
 * a yellow notice and can still be sent. Nothing entered means no notice.
 */
test.describe("suggested sending hours", () => {
  test.describe.configure({ mode: "serial" });

  async function cleanup() {
    await resetE2eSendingHours();
    await cleanupE2eControlCampaigns(PREFIX);
  }
  test.beforeAll(cleanup);
  test.afterAll(cleanup);

  /** An hour-long window in Spain that cannot contain the current time there. */
  function windowAwayFromNow(): string {
    const hour = Number(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/Madrid",
        hour: "2-digit",
        hourCycle: "h23",
      }).format(new Date()),
    );
    return hour < 12 ? "20:00-21:00" : "03:00-04:00";
  }

  test("hours saved in Settings show a notice on a campaign outside them, and can be cleared", async ({
    page,
  }) => {
    const hours = windowAwayFromNow();
    await page.goto("/settings");
    await page.getByTestId("sending-hours-link").click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Suggested sending hours" }),
    ).toBeVisible();

    // A line that is not "CC HH:MM-HH:MM" is refused with the line number.
    const box = page.getByLabel("One country per line: the 2-letter code, then the hours");
    await box.fill("Spain all day");
    await page.getByTestId("save-sending-hours").click();
    await expect(page.getByTestId("sending-hours-form").getByRole("alert")).toContainText(
      "Line 1 is not",
    );

    await box.fill(`es ${hours}`);
    await page.getByTestId("save-sending-hours").click();
    await expect(page.getByTestId("toast").last()).toContainText("Sending hours saved");
    await page.reload();
    await expect(box).toHaveValue(`ES ${hours}`);

    // A new Spanish campaign, Send Now: the notice names the country and the hours.
    await page.goto("/campaigns");
    await page.getByTestId("new-campaign").click();
    const dialog = page.getByRole("dialog", { name: "New Campaign" });
    await dialog.getByLabel("Name").fill(`${PREFIX} ${Date.now()}`);
    await dialog.getByLabel("Country").selectOption("ES");
    await dialog.getByRole("button", { name: "Create campaign" }).click();
    await expect(page).toHaveURL(/\/campaigns\/[0-9a-f-]{36}$/);
    const campaignUrl = page.url();
    const notice = page.getByTestId("sending-hours-notice");
    await expect(notice).toContainText("Outside the suggested sending hours for Spain");
    await expect(notice).toContainText(hours.replace("-", "–"));
    await expect(notice).toContainText("You can still send.");

    // Clearing the hours removes the notice.
    await page.goto("/settings/sending-hours");
    // A click before the form is interactive would be a plain page submit; try until it saves.
    await expect(async () => {
      await box.fill("");
      await page.getByTestId("save-sending-hours").click();
      await expect(page.getByTestId("toast").last()).toContainText("Sending hours saved", {
        timeout: 3_000,
      });
    }).toPass({ timeout: 30_000 });
    await page.goto(campaignUrl);
    await expect(page.getByTestId("campaign-name")).toBeVisible();
    await expect(notice).toHaveCount(0);
  });
});
