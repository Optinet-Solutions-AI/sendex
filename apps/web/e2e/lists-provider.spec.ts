import { expect, type Page, test } from "@playwright/test";
import { cleanupE2eLists } from "./helpers/db";

/**
 * A list's data provider (D5-01): typed on upload for a new list, shown in the list header,
 * and changed there. Runs under the development auth stub; the helper removes the list.
 */

const E2E_PREFIX = "E2E Provider";
const E2E_E164_PREFIX = "+44770090019";

async function cleanup() {
  await cleanupE2eLists(E2E_PREFIX, E2E_E164_PREFIX);
}

test.beforeAll(cleanup);
test.afterAll(cleanup);

async function pickOption(page: Page, triggerLabel: string, optionName: string | RegExp) {
  await page.getByRole("combobox", { name: triggerLabel }).click();
  await page.getByRole("option", { name: optionName }).click();
}

test("a new list keeps the data provider typed on upload, and it can be changed", async ({
  page,
}) => {
  const listName = `${E2E_PREFIX} ${Date.now()}`;

  await page.goto("/lists/upload");
  await page.getByRole("button", { name: "Paste CSV" }).click();
  await page.getByLabel("Paste phone numbers, one per line").fill("447700900191\n447700900192");
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  await expect(page.getByTestId("import-rows")).toHaveText("2 rows");

  await pickOption(page, "Fixed Country", /United Kingdom/);
  await page.getByLabel("New List Name").fill(listName);
  await page.getByLabel(/Data provider/).fill("ZEN");
  await page.getByTestId("import-button").click();
  await expect(page.getByTestId("upload-summary")).toBeVisible({ timeout: 30_000 });

  await page.goto("/lists");
  await page.getByRole("link", { name: listName }).click();
  await expect(page.getByTestId("list-provider")).toHaveText("ZEN");

  await page.getByRole("button", { name: "Edit data provider" }).click();
  await page.getByLabel("Data provider").fill("DER");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId("list-provider")).toHaveText("DER");

  await page.reload();
  await expect(page.getByTestId("list-provider")).toHaveText("DER");
});
