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

/** The fixture's two landlines are kept as Bad contacts, so they are cleaned up as well. */
const E2E_LANDLINE_PREFIXES = ["+3491234567", "+3493234567"] as const;

async function cleanup() {
  await cleanupE2eLists(E2E_PREFIX, E2E_E164_PREFIX);
  for (const prefix of E2E_LANDLINE_PREFIXES) await cleanupE2eLists(E2E_PREFIX, prefix);
}

test.beforeAll(cleanup);
test.afterAll(cleanup);

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
    await expect(page.getByRole("heading", { level: 1, name: "Upload Contacts" })).toBeVisible();

    await page.getByRole("button", { name: "Paste CSV" }).click();
    await page.getByLabel("Paste phone numbers, one per line").fill(numbers);
    await page.getByRole("button", { name: "Upload", exact: true }).click();
    // The Import step after SMS Edge: Settings and File Details on the left, Field Types grid.
    await expect(page.getByRole("heading", { level: 1, name: "Import pasted text" })).toBeVisible();
    await expect(page.getByTestId("import-rows")).toHaveText("20 rows");
    await expect(page.getByRole("combobox", { name: "Type of column A" })).toContainText(
      "Phone Number",
    );
    await expect(page.getByTestId("number-column")).toContainText("Set");
    await expect(page.getByRole("combobox", { name: "List" })).toContainText("+ New List");

    // No country column, so "Auto-detect from file" blocks the import until a country is picked.
    await expect(page.getByTestId("country-error")).toContainText("Pick a country");
    await expect(page.getByTestId("import-button")).toBeDisabled();
    await pickOption(page, "Fixed Country", /Spain/);
    await expect(page.getByTestId("country-error")).toHaveCount(0);

    await page.getByLabel("New List Name").fill(listName);
    await expect(page.getByRole("checkbox", { name: /Logical Check/ })).toBeChecked();
    await expect(page.getByRole("combobox", { name: "Duplicates" })).toContainText(
      "Allow duplicates",
    );

    await page.getByTestId("import-button").click();

    const summary = page.getByTestId("upload-summary");
    await expect(summary).toBeVisible({ timeout: 30_000 });
    // 20 rows: 17 good, 2 landlines kept as Bad, 1 rejected ("12345").
    await expect(page.getByTestId("summary-rows")).toHaveText("20");
    await expect(page.getByTestId("summary-imported")).toHaveText("19");
    await expect(page.getByTestId("summary-good")).toHaveText("17");
    await expect(page.getByTestId("summary-bad")).toHaveText("2");
    await expect(page.getByTestId("summary-skipped")).toHaveText("0");
    await expect(page.getByTestId("summary-duplicates")).toHaveText("0");
    await expect(page.getByTestId("summary-dropped")).toHaveText("1");
    await expect(page.getByTestId("bad-landline")).toHaveText("2");
    await expect(page.getByTestId("drop-invalid")).toHaveText("1");
    await expect(page.getByTestId("drop-landline")).toHaveText("0");

    // The import is on the Files page with its result.
    await page.goto("/lists/files");
    const fileRow = page.getByTestId("file-row").filter({ hasText: listName }).first();
    await expect(fileRow).toContainText("pasted text");
    await expect(fileRow).toContainText("19 / 20");
    await fileRow.getByRole("button", { name: "Show import summary" }).click();
    const fileSummary = page.getByTestId("file-summary").first();
    await expect(fileSummary).toContainText(
      "20 rows → 19 added (17 good, 2 bad) · 1 rejected · 0 skipped",
    );
    await expect(fileSummary).toContainText("Not Mobile");

    // The new list is in the table with its 19 numbers.
    await page.goto(`/lists?search=${encodeURIComponent(listName)}`);
    const row = page.getByRole("row", { name: new RegExp(listName) });
    await expect(row).toBeVisible();
    await expect(row).toContainText("19");
    await expect(row).toContainText("ES");

    // Flush it from the row menu and confirm.
    await page.getByRole("button", { name: `Actions for ${listName}` }).click();
    await page.getByRole("menuitem", { name: "Flush" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText(`Flush ${listName}?`);
    await dialog.getByRole("button", { name: "Flush list" }).click();
    await expect(page.getByTestId("toast")).toContainText(`Flushed ${listName}`);
    await expect(page.getByTestId("toast")).toContainText("19 numbers reset");

    // The detail page shows the counts and full numbers.
    await row.getByRole("link", { name: listName, exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: listName })).toBeVisible();
    await expect(page.getByTestId("count-members")).toHaveText("19");
    await expect(page.getByTestId("count-good")).toHaveText("17");
    await expect(page.getByTestId("count-sent")).toHaveText("0");
    await expect(page.getByTestId("count-bad")).toHaveText("2");
    // Numbers are masked in the Contacts tab; Bad rows carry the badge.
    await expect(page.getByText("+3462200****", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("+34622000001", { exact: true })).toHaveCount(0);
    await page.getByLabel("Status").selectOption("bad");
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page.getByTestId("contact-row")).toHaveCount(2);
    await expect(page.getByTestId("contact-row").first()).toContainText("Bad");
    // The other tabs: Lookup totals, Campaigns empty state, Data Files with the upload.
    // The tabs are client-side; right after a navigation they may not be hydrated yet.
    const openTab = async (name: string, param: string) => {
      await expect(async () => {
        await page.getByRole("tab", { name }).click();
        await expect(page).toHaveURL(new RegExp(`tab=${param}`), { timeout: 2_000 });
      }).toPass();
    };
    await openTab("Lookup", "lookup");
    await expect(
      page.locator('[data-testid="lookup-row"][data-country="All Countries"]'),
    ).toContainText("19");
    await openTab("Campaigns", "campaigns");
    await expect(page.getByText("No campaigns yet")).toBeVisible();
    await openTab("Data Files", "files");
    await expect(page.getByTestId("upload-card").first()).toContainText("19 added to list");
    await openTab("Analytics", "analytics");
    await expect(page.getByTestId("list-analytics-table")).toContainText("Whole list");

    // Archive it from the row menu: it leaves the table, shows under "Show archived", comes back.
    await page.goto(`/lists?search=${encodeURIComponent(listName)}`);
    await page.getByRole("button", { name: `Actions for ${listName}` }).click();
    // Fully on screen, not cut off by the table's scroll box (the only row has no room below).
    await expect(page.getByRole("menuitem", { name: "Archive" })).toBeInViewport({ ratio: 1 });
    await page.getByRole("menuitem", { name: "Archive" }).click();
    await expect(page.getByTestId("toast")).toContainText(`Archived ${listName}`);
    await expect(page.getByRole("row", { name: new RegExp(listName) })).toHaveCount(0);
    await page.goto(`/lists?search=${encodeURIComponent(listName)}&archived=1`);
    const archivedRow = page.getByRole("row", { name: new RegExp(listName) });
    await expect(archivedRow).toBeVisible();
    await expect(archivedRow).toContainText("Archived");
    await page.getByRole("button", { name: `Actions for ${listName}` }).click();
    // Fully on screen, not cut off by the table's scroll box (the only row has no room below).
    await expect(page.getByRole("menuitem", { name: "Unarchive" })).toBeInViewport({ ratio: 1 });
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
