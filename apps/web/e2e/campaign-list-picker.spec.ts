import { expect, test } from "@playwright/test";
import { flushListByName } from "./helpers/db";

/**
 * The Lists row of the send form is a real dropdown (D4-20): it opens under the row, the
 * list can be found by typing its name, and Enter or a click picks it. Uses the seeded ES
 * list of the demo seed.
 */
const LIST = "Roy Boy_ES_14092026_Batch2";

test.describe("campaign list picker", () => {
  test.beforeEach(() => flushListByName(LIST));

  test("the Lists row opens a dropdown where a list is found by typing its name", async ({
    page,
  }) => {
    await page.goto("/campaigns");
    await page.getByTestId("new-campaign").click();
    const dialog = page.getByRole("dialog", { name: "New Campaign" });
    await dialog.getByLabel("Name").fill(`E2E List picker ${Date.now()}`);
    await dialog.getByLabel("Country").selectOption("ES");
    await dialog.getByRole("button", { name: "Create campaign" }).click();
    await expect(page).toHaveURL(/\/campaigns\/[0-9a-f-]{36}$/);

    const row = page.getByRole("button", { name: "Lists", exact: true });
    await expect(row).toContainText("Select lists or segments");
    await row.click();
    const picker = page.getByTestId("list-picker");
    await expect(picker).toBeVisible();
    const search = picker.getByPlaceholder("Type a list name…");
    await expect(search).toBeFocused();

    // Typing narrows the lists; a name that does not exist says so.
    await search.fill("no such list");
    await expect(picker).toContainText("No list matches");
    await search.fill("batch2 roy");
    await expect(picker.getByTestId("list-picker-option")).toHaveCount(1);
    await expect(picker.getByTestId("list-picker-option")).toContainText(LIST);

    // Enter picks the first match.
    await search.press("Enter");
    await expect(picker.getByLabel(LIST, { exact: true })).toBeChecked();
    await expect(page.getByTestId("footer-contacts")).toHaveText("1,738");

    // The row and the Lists tab on the right agree.
    await page.keyboard.press("Escape");
    await expect(picker).toBeHidden();
    await expect(row).toContainText(LIST);
    await expect(page.getByTestId("lists-panel").getByLabel(LIST, { exact: true })).toBeChecked();

    // A click in the dropdown takes it off again.
    await row.click();
    await page.getByTestId("list-picker").getByLabel(LIST, { exact: true }).uncheck();
    await page.keyboard.press("Escape");
    await expect(row).toContainText("Select lists or segments");
  });
});
