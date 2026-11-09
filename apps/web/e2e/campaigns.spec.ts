import { expect, test } from "@playwright/test";
import { flushListByName } from "./helpers/db";

/**
 * Happy path of the campaign screens as the seeded development owner (`SENDEX_DEV_AUTH=1`,
 * organisation "external"). Needs the demo seed: the ES list, the "ES Casino" sender id group
 * and platform routes 405 (EUR 0.025) and 403 for Spain.
 */
test.describe("campaigns", () => {
  // The engine may have sent to this list in earlier local runs; start from a full list.
  test.beforeEach(() => flushListByName("Roy Boy_ES_14092026_Batch2"));

  test("the ad text counter counts the real link, and Long message lets a two-part text through", async ({
    page,
  }) => {
    await page.goto("/campaigns");
    await page.getByTestId("new-campaign").click();
    const dialog = page.getByRole("dialog", { name: "New Campaign" });
    await dialog.getByLabel("Name").fill(`E2E Long message ${Date.now()}`);
    await dialog.getByLabel("Country").selectOption("ES");
    await dialog.getByRole("button", { name: "Create campaign" }).click();
    await expect(page).toHaveURL(/\/campaigns\/[0-9a-f-]{36}$/);

    await page.getByRole("button", { name: "Ad Texts", exact: true }).click();
    await page.getByTestId("add-texts").click();
    const editor = page.getByRole("dialog", { name: "Add Ad Texts" });
    // No opt-out chip until the opt-out wording is decided.
    await expect(editor.getByRole("button", { name: "Opt-Out" })).toHaveCount(0);

    // 141 characters as typed, but over 160 once {{domain}} becomes the short link.
    await editor.getByTestId("ad-text-input").fill(`${"a".repeat(130)} {{domain}}`);
    await expect(editor.getByTestId("ad-text-parts-1")).toHaveText("2 parts");
    await expect(editor.getByTestId("save-ad-text")).toBeDisabled();

    await editor.getByRole("switch", { name: "Long message" }).click();
    await expect(editor.getByTestId("save-ad-text")).toBeEnabled();
    await editor.getByTestId("save-ad-text").click();
    await expect(editor).toBeHidden();
    await expect(page.getByTestId("ad-text-row")).toContainText("2 parts");
  });

  test("the Logs tab opens its Ad Texts, Offers and SIDs panels", async ({ page }) => {
    await page.goto("/campaigns");
    await page.getByTestId("new-campaign").click();
    const dialog = page.getByRole("dialog", { name: "New Campaign" });
    await dialog.getByLabel("Name").fill(`E2E Logs ${Date.now()}`);
    await dialog.getByLabel("Country").selectOption("ES");
    await dialog.getByRole("button", { name: "Create campaign" }).click();
    await expect(page).toHaveURL(/\/campaigns\/[0-9a-f-]{36}$/);
    const url = page.url();

    for (const [sub, panel] of [
      ["adtexts", "ad-texts-panel"],
      ["offers", "links-panel"],
      ["sids", "sid-panel"],
    ] as const) {
      await page.goto(`${url}?tab=logs&logs=${sub}`);
      await expect(page.getByTestId(panel)).toBeVisible();
    }
  });

  test("create a Spanish campaign, build the send form, estimate and queue two laps", async ({
    page,
  }) => {
    const name = `E2E Spain ${Date.now()}`;

    await page.goto("/campaigns");
    await expect(page.getByRole("heading", { level: 1, name: "Campaigns" })).toBeVisible();
    await expect(page.getByTestId("campaign-count")).toContainText(/campaign/);

    // New Campaign modal: the timezone follows the country.
    await page.getByTestId("new-campaign").click();
    const dialog = page.getByRole("dialog", { name: "New Campaign" });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Name").fill(name);
    await dialog.getByLabel("Country").selectOption("ES");
    await expect(dialog.getByLabel("Timezone")).toHaveValue("Europe/Madrid");
    await dialog.getByRole("button", { name: "Create campaign" }).click();

    // Creating redirects to the campaign page.
    await expect(page).toHaveURL(/\/campaigns\/[0-9a-f-]{36}$/);
    await expect(page.getByTestId("campaign-name")).toHaveText(name);
    await expect(page.getByText("🇪🇸 Spain · Europe/Madrid")).toBeVisible();
    await expect(page.getByTestId("sending-progress")).toContainText("0 /");

    // Sender ids: the seeded ES group.
    const sidSelect = page.getByTestId("sid-group-select");
    const groupValue = await sidSelect
      .locator("option", { hasText: "ES Casino" })
      .getAttribute("value");
    if (!groupValue) throw new Error("seeded group ES Casino not found");
    await sidSelect.selectOption(groupValue);
    await expect(page.getByTestId("footer-sids")).not.toHaveText(/^(0|–)$/);

    // Lists: the seeded ES list.
    // Each form row opens its context tab on the right.
    await page.getByRole("button", { name: "Lists", exact: true }).click();
    const listsPanel = page.getByTestId("lists-panel");
    await listsPanel.getByLabel("Roy Boy_ES_14092026_Batch2", { exact: true }).check();
    await expect(page.getByTestId("footer-contacts")).toHaveText("1,738");

    // Ad text with {{domain}}: the counter shows one part.
    await page.getByRole("button", { name: "Ad Texts", exact: true }).click();
    await page.getByTestId("add-texts").click();
    const editor = page.getByRole("dialog", { name: "Add Ad Texts" });
    await editor.getByTestId("ad-text-input").fill("Gira y gana hoy en {{domain}}");
    await expect(editor.getByTestId("ad-text-parts-1")).toHaveText("1 part");
    await editor.getByTestId("save-ad-text").click();
    await expect(editor).toBeHidden();
    await expect(page.getByTestId("ad-text-row")).toHaveCount(1);
    await expect(page.getByTestId("footer-texts")).toHaveText("1");

    // Test size 200 (the default) and route 405 at EUR 0.025: 200 SMS for EUR 5.00.
    await page.getByRole("switch", { name: "Advanced Settings" }).click();
    await expect(page.getByTestId("test-size")).toHaveValue("200");
    await page
      .getByTestId("schedule-panel")
      .getByRole("button", { name: "Routes", exact: true })
      .click();
    await page.getByTestId("route-405").check();
    await expect(page.getByTestId("footer-sms")).toHaveText("200");
    await expect(page.getByTestId("footer-cost")).toHaveText("~€5.00");

    // A second route doubles the laps: 400 SMS.
    await page.getByTestId("route-403").check();
    await expect(page.getByTestId("footer-sms")).toHaveText("400");
    await expect(page.getByTestId("footer-cost")).toHaveText("~€10.40");

    // Send: two laps queued, one per route.
    await page.getByTestId("send-button").click();
    const rows = page.getByTestId("lap-row");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toHaveAttribute("data-lap-status", "queued");
    await expect(rows.nth(1)).toHaveAttribute("data-lap-status", "queued");
    await expect(page.getByTestId("laps-table")).toContainText("405");
    await expect(page.getByTestId("laps-table")).toContainText("403");

    // The campaign list shows the new campaign with its two laps.
    await page.goto("/campaigns");
    const row = page.getByTestId("campaign-row").filter({ hasText: name });
    await expect(row).toBeVisible();
    await expect(row.locator("[data-status]")).toHaveAttribute("data-status", "sending");
    await expect(row.locator("td").nth(4)).toHaveText("2");
  });
});
