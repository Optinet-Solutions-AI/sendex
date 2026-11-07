import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { cleanupE2eLists } from "./helpers/db";

/**
 * Lists screens under the development auth stub (owner of the seeded "external" organisation).
 * The upload uses a unique list name per run and the helper deletes the list and its contacts
 * before and after, so the spec can run repeatedly against the same database.
 */

const SEEDED_LISTS = [
  "Roy Boy_ES_14092026_Batch2",
  "Roy Boy_FR_14092026_Batch2",
  "Roy Boy_UK_14092026_Batch2",
  "Roy Boy_DE_14092026_Batch2",
  "Roy Boy_PL_14092026_Batch2",
  "Roy Boy_FI_14092026_Batch2",
] as const;

const FIXTURE = join(__dirname, "fixtures", "es-numbers.csv");
const E2E_PREFIX = "E2E ES";
const E2E_E164_PREFIX = "+34622000";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await cleanupE2eLists(E2E_PREFIX, E2E_E164_PREFIX);
});

test.afterAll(async () => {
  await cleanupE2eLists(E2E_PREFIX, E2E_E164_PREFIX);
});

async function pickOption(page: Page, triggerLabel: string, optionName: string | RegExp) {
  await page.getByRole("combobox", { name: triggerLabel }).click();
  await page.getByRole("option", { name: optionName }).click();
}

test.describe("lists", () => {
  test("the lists table shows the six seeded lists with their columns", async ({ page }) => {
    await page.goto("/lists");

    await expect(page.getByRole("heading", { level: 1, name: "Lists" })).toBeVisible();
    for (const name of SEEDED_LISTS) {
      await expect(page.getByRole("link", { name, exact: true })).toBeVisible();
    }
    const header = page.getByRole("table").first().locator("thead");
    for (const column of [
      "Name",
      "Numbers",
      "Countries",
      "Sent",
      "CTR",
      "Last Upload",
      "Created",
    ]) {
      await expect(header.getByText(column, { exact: true })).toBeVisible();
    }
    await expect(page.getByRole("link", { name: "Upload List" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Flush All Lists" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Export CSV" })).toBeVisible();
  });

  test("searching and filtering by country narrows the table", async ({ page }) => {
    await page.goto("/lists?country=FR");
    await expect(page.getByRole("link", { name: SEEDED_LISTS[1], exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: SEEDED_LISTS[0], exact: true })).toHaveCount(0);

    await page.goto("/lists");
    await page.getByRole("searchbox", { name: "Search lists" }).fill("_UK_");
    await page.getByRole("button", { name: "Search" }).click();
    await expect(page).toHaveURL(/search=_UK_/);
    await expect(page.getByRole("link", { name: SEEDED_LISTS[2], exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: SEEDED_LISTS[0], exact: true })).toHaveCount(0);
  });

  test("the CSV export returns the table as a file", async ({ request }) => {
    const response = await request.get("/lists/export?country=ES");
    expect(response.ok()).toBe(true);
    expect(response.headers()["content-type"]).toContain("text/csv");
    const body = await response.text();
    expect(body.split("\r\n")[0]).toBe(
      "Name,Numbers,Country,Sent,CTR,Leads,Sales,Spend,Last sent,Last upload,Created",
    );
    expect(body).toContain("Roy Boy_ES_14092026_Batch2,1738,ES,");
  });

  test("upload a pasted Spanish list, see the summary, then flush it from the row menu", async ({
    page,
  }) => {
    const listName = `${E2E_PREFIX} ${Date.now()}`;
    const numbers = readFileSync(FIXTURE, "utf8");

    await page.goto("/lists/upload");
    await expect(page.getByRole("heading", { level: 1, name: "Upload List" })).toBeVisible();

    await page.getByLabel("Or paste numbers, one per line").fill(numbers);
    await page.getByRole("button", { name: "Use pasted data" }).click();
    await expect(page.getByText("20 rows from pasted text")).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Type of column 1" })).toContainText("Phone");

    await page.getByRole("radio", { name: "New list" }).check();
    await page.getByLabel("List name").fill(listName);
    await pickOption(page, "Country", /Spain/);
    await expect(page.getByRole("checkbox", { name: /Logical check/ })).toBeChecked();

    await page.getByTestId("import-button").click();

    const summary = page.getByTestId("upload-summary");
    await expect(summary).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("summary-rows")).toHaveText("20");
    await expect(page.getByTestId("summary-imported")).toHaveText("17");
    await expect(page.getByTestId("summary-skipped")).toHaveText("0");
    await expect(page.getByTestId("summary-duplicates")).toHaveText("0");
    await expect(page.getByTestId("summary-dropped")).toHaveText("3");
    await expect(page.getByTestId("drop-landline")).toHaveText("2");
    await expect(page.getByTestId("drop-invalid")).toHaveText("1");
    await expect(page.getByTestId("drop-unparseable")).toHaveText("0");

    // The new list is in the table with its 17 numbers.
    await page.goto(`/lists?search=${encodeURIComponent(listName)}`);
    const row = page.getByRole("row", { name: new RegExp(listName) });
    await expect(row).toBeVisible();
    await expect(row).toContainText("17");
    await expect(row).toContainText("ES");

    // Flush it from the row menu and confirm.
    await page.getByRole("button", { name: `Actions for ${listName}` }).click();
    await page.getByRole("menuitem", { name: "Flush" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText(`Flush ${listName}?`);
    await dialog.getByRole("button", { name: "Flush list" }).click();
    await expect(page.getByTestId("toast")).toContainText(`Flushed ${listName}`);
    await expect(page.getByTestId("toast")).toContainText("17 numbers reset");

    // The detail page shows the counts and full numbers.
    await row.getByRole("link", { name: listName, exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: listName })).toBeVisible();
    await expect(page.getByTestId("count-members")).toHaveText("17");
    await expect(page.getByTestId("count-available")).toHaveText("17");
    await expect(page.getByTestId("count-sent")).toHaveText("0");
    await expect(page.getByText("+34622000001", { exact: true })).toBeVisible();

    // Archive it from the row menu: it leaves the table, shows under "Show archived", comes back.
    await page.goto(`/lists?search=${encodeURIComponent(listName)}`);
    await page.getByRole("button", { name: `Actions for ${listName}` }).click();
    await page.getByRole("menuitem", { name: "Archive" }).click();
    await expect(page.getByTestId("toast")).toContainText(`Archived ${listName}`);
    await expect(page.getByRole("row", { name: new RegExp(listName) })).toHaveCount(0);
    await page.goto(`/lists?search=${encodeURIComponent(listName)}&archived=1`);
    const archivedRow = page.getByRole("row", { name: new RegExp(listName) });
    await expect(archivedRow).toBeVisible();
    await expect(archivedRow).toContainText("Archived");
    await page.getByRole("button", { name: `Actions for ${listName}` }).click();
    await page.getByRole("menuitem", { name: "Unarchive" }).click();
    await expect(page.getByTestId("toast")).toContainText(`Unarchived ${listName}`);

    // Bulk select and delete: the row checkbox, the selection bar, confirm, gone.
    await page.goto(`/lists?search=${encodeURIComponent(listName)}`);
    await page.getByRole("checkbox", { name: `Select ${listName}` }).check();
    await expect(page.getByTestId("selection-bar")).toContainText("1 list selected");
    await page.getByRole("button", { name: "Delete selected" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
    await expect(page.getByTestId("toast")).toContainText("1 list deleted");
    await expect(page.getByRole("row", { name: new RegExp(listName) })).toHaveCount(0);
  });
});
