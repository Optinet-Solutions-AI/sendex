import { expect, type Page, test } from "@playwright/test";
import { cleanupE2eLists } from "./helpers/db";

/**
 * Upload checks found on 2026-11-12 with a German file exported from SMS Edge:
 *   - numbers written with the country code and no plus (4915155501234) are mobiles, not
 *     local landlines;
 *   - cells a spreadsheet program cut short (4.91516E+12) are announced before the import and
 *     rejected with their own reason.
 * Runs under the development auth stub; the helper removes the list and its contacts.
 */

const E2E_PREFIX = "E2E DE numbers";
const E2E_E164_PREFIX = "+49151555012";

const PASTED = ["4915155501234", "4915155501235", "4.91516E+12", "4.9175E+11"].join("\n");

async function cleanup() {
  await cleanupE2eLists(E2E_PREFIX, E2E_E164_PREFIX);
}

test.beforeAll(cleanup);
test.afterAll(cleanup);

async function pickOption(page: Page, triggerLabel: string, optionName: string | RegExp) {
  await page.getByRole("combobox", { name: triggerLabel }).click();
  await page.getByRole("option", { name: optionName }).click();
}

test("a German list: country-code numbers are good, spreadsheet-damaged ones are rejected", async ({
  page,
}) => {
  const listName = `${E2E_PREFIX} ${Date.now()}`;

  await page.goto("/lists/upload");
  await page.getByRole("button", { name: "Paste CSV" }).click();
  await page.getByLabel("Paste phone numbers, one per line").fill(PASTED);
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  await expect(page.getByTestId("import-rows")).toHaveText("4 rows");

  // The warning is there before anything is imported.
  const warning = page.getByTestId("damaged-warning");
  await expect(warning).toContainText("2 of 4 numbers were cut short by a spreadsheet program");
  await expect(warning).toContainText("4.91516E+12");

  await pickOption(page, "Fixed Country", /Germany/);
  await page.getByLabel("New List Name").fill(listName);
  await expect(page.getByRole("checkbox", { name: /Logical Check/ })).toBeChecked();
  await page.getByTestId("import-button").click();

  await expect(page.getByTestId("upload-summary")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("summary-rows")).toHaveText("4");
  await expect(page.getByTestId("summary-imported")).toHaveText("2");
  await expect(page.getByTestId("summary-good")).toHaveText("2");
  await expect(page.getByTestId("summary-bad")).toHaveText("0");
  await expect(page.getByTestId("summary-duplicates")).toHaveText("0");
  await expect(page.getByTestId("summary-dropped")).toHaveText("2");
  await expect(page.getByTestId("drop-damaged")).toHaveText("2");
  await expect(page.getByTestId("bad-landline")).toHaveText("0");

  // The Files page names the damage in its result box.
  await page.goto("/lists/files");
  const fileRow = page.getByTestId("file-row").filter({ hasText: listName }).first();
  await fileRow.getByRole("button", { name: "Show import summary" }).click();
  await expect(page.getByTestId("file-summary").first()).toContainText("Damaged by a spreadsheet");
});
