import { expect, type Page, test } from "@playwright/test";
import { cleanupE2eControlCampaigns, cleanupE2eLists, cleanupE2eRoutes } from "./helpers/db";

/**
 * QA round two left these checks pending because the tester did not want to change live
 * data: L9 (two files in one import), L10 (delete a file record only), L12 (bulk delete a
 * list) and S11 (Send Single from the campaign page). They run here against the local
 * database; the Send Single test is only queued, nothing reaches a carrier.
 */

const PREFIX = "E2E QA";
const E164_PREFIX = "+34622001";

test.describe.configure({ mode: "serial" });

async function cleanup() {
  await cleanupE2eLists(PREFIX, E164_PREFIX);
  await cleanupE2eControlCampaigns(PREFIX);
  await cleanupE2eRoutes(PREFIX);
}

test.beforeAll(cleanup);
test.afterAll(cleanup);

async function pickOption(page: Page, triggerLabel: string, optionName: string | RegExp) {
  await page.getByRole("combobox", { name: triggerLabel }).click();
  await page.getByRole("option", { name: optionName }).click();
}

function csv(numbers: string[]) {
  return Buffer.from(`${numbers.join("\n")}\n`, "utf8");
}

const FILE_A = {
  name: "e2e-qa-a.csv",
  mimeType: "text/csv",
  buffer: csv(["+34622001001", "+34622001002", "+34622001003"]),
};
const FILE_B = {
  name: "e2e-qa-b.csv",
  mimeType: "text/csv",
  buffer: csv(["+34622001004", "+34622001005"]),
};

test("L9, L10, L12: import two files into one list, delete a file record, bulk delete the list", async ({
  page,
}) => {
  const listName = `${PREFIX} ${Date.now()}`;

  // L9: pick both files and remove one in File Details; the import step has no "add file",
  // so adding it back means picking both again from the upload page. Then import.
  await page.goto("/lists/upload");
  await page.getByTestId("file-input").setInputFiles([FILE_A, FILE_B]);
  await expect(page.getByTestId("import-rows")).toHaveText("5 rows");
  await page.getByRole("button", { name: `Remove ${FILE_B.name}` }).click();
  await expect(page.getByTestId("import-rows")).toHaveText("3 rows");
  await page.goto("/lists/upload");
  await page.getByTestId("file-input").setInputFiles([FILE_A, FILE_B]);
  await expect(page.getByTestId("import-rows")).toHaveText("5 rows");

  await pickOption(page, "Fixed Country", /Spain/);
  await page.getByLabel("New List Name").fill(listName);
  await page.getByTestId("import-button").click();

  const summary = page.getByTestId("upload-summary");
  await expect(summary).toBeVisible({ timeout: 30_000 });
  await expect(summary).toContainText("(2 files)");
  await expect(page.getByTestId("summary-imported")).toHaveText("5");

  // Both files are on the Files page as separate records.
  await page.goto("/lists/files");
  const rows = page.getByTestId("file-row").filter({ hasText: listName });
  await expect(rows).toHaveCount(2);

  // L10: deleting a file record keeps the list and its numbers.
  await page
    .getByRole("button", { name: `Delete ${FILE_A.name}` })
    .first()
    .click();
  const confirmFile = page.getByRole("alertdialog").or(page.getByRole("dialog"));
  await expect(confirmFile).toContainText("Delete file record");
  await confirmFile.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByTestId("toast").last()).toContainText("File record deleted");
  await expect(rows).toHaveCount(1);

  await page.goto(`/lists?search=${encodeURIComponent(listName)}`);
  const listRow = page.getByRole("row", { name: new RegExp(listName) });
  await expect(listRow).toContainText("5");

  // L12: tick the list, the bar counts it, Delete selected, confirm.
  await page.getByRole("checkbox", { name: `Select ${listName}` }).click();
  await expect(page.getByTestId("selection-bar")).toContainText("1 list selected");
  await expect(page.getByTestId("selection-bar")).toContainText("Clear selection");
  await page.getByRole("button", { name: "Delete selected" }).click();
  const confirmList = page.getByRole("alertdialog").or(page.getByRole("dialog"));
  await expect(confirmList).toContainText(`Delete "${listName}"?`);
  await confirmList.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByTestId("toast").last()).toContainText("1 list deleted");
  await expect(listRow).toHaveCount(0);
});

test("S11: Send Single on the campaign page starts on the campaign's country and queues a test", async ({
  page,
}) => {
  await page.goto("/campaigns");
  await page.getByTestId("new-campaign").click();
  const dialog = page.getByRole("dialog", { name: "New Campaign" });
  await dialog.getByLabel("Name").fill(`${PREFIX} single ${Date.now()}`);
  await dialog.getByLabel("Country").selectOption("ES");
  await dialog.getByRole("button", { name: "Create campaign" }).click();
  await expect(page).toHaveURL(/\/campaigns\/[0-9a-f-]{36}$/);

  await page.goto(`${page.url()}?tab=single`);
  const form = page.getByTestId("send-single-form");
  await expect(form.getByTestId("single-country")).toHaveValue("ES");
  await form.getByTestId("single-recipient").fill("34622001099");
  await form
    .getByTestId("single-routes")
    .getByLabel(/Route 405/)
    .check();
  await form.getByTestId("sender-random_shop").check();
  await expect(form.getByTestId("cost-estimate")).toBeVisible();
  await form.getByLabel("Hypothesis").fill(`${PREFIX} single`);
  await form.getByTestId("single-send").click();
  await expect(page.getByTestId("toast").last()).toContainText("Test queued");

  // The test is listed under Routes > Testing.
  await page.goto("/routes/testing");
  const row = page.getByTestId("test-row").first();
  await expect(row).toContainText("Spain");
  await expect(row).toContainText("405");
});
