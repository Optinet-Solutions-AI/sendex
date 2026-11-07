import { expect, test } from "@playwright/test";
import { cleanupE2eSegments } from "./helpers/db";

const PREFIX = "E2E Segment";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await cleanupE2eSegments(PREFIX);
});

test.afterAll(async () => {
  await cleanupE2eSegments(PREFIX);
});

/**
 * Contacts › Segments: build a segment with the rule rows, watch the validation banner and
 * the live preview, save, see it listed with its summary, refresh stats, duplicate, delete.
 */
test.describe("segments", () => {
  test("build, preview, save, list, duplicate and delete a segment", async ({ page }) => {
    const name = `${PREFIX} ${Date.now()}`;
    await page.goto("/segments/new");
    await expect(page.getByTestId("segment-preview")).toContainText(
      "Add rules to see audience count",
    );

    await page.getByTestId("segment-name").fill(name);
    await page.getByTestId("add-rule").click();
    // A fresh rule is Country · equals · Select…: invalid until a value is picked.
    await expect(page.getByTestId("segment-problems")).toContainText(
      "Rule 1 (Country): missing value",
    );
    await expect(page.getByTestId("segment-save")).toBeDisabled();
    await page.getByLabel("Rule 1 value").selectOption("ES");
    await expect(page.getByTestId("segment-problems")).toHaveCount(0);

    // The preview counts the seeded Spanish contacts.
    await expect(page.getByTestId("preview-total")).not.toHaveText("• • •", { timeout: 15_000 });
    const total = Number(
      (await page.getByTestId("preview-total").textContent())?.replace(/,/g, ""),
    );
    expect(total).toBeGreaterThan(0);
    await page.getByRole("tab", { name: "Countries" }).click();
    await expect(page.getByTestId("segment-preview")).toContainText("ES Spain");

    // A second rule in a nested group, then remove it: the toast confirms.
    await page.getByTestId("add-group").click();
    await expect(page.getByTestId("segment-rule")).toHaveCount(2);
    await page.getByRole("button", { name: "Remove rule 2" }).click();
    await expect(page.getByTestId("toast").last()).toContainText("Rule removed");
    await page.getByRole("button", { name: "Remove group" }).click();
    await expect(page.getByTestId("segment-rule")).toHaveCount(1);

    await page.getByTestId("segment-save").click();
    await expect(page).toHaveURL(/\/segments\/[0-9a-f-]{36}$/);
    await expect(page.getByTestId("segment-name")).toHaveValue(name);
    await expect(page.getByText("Country equals ES", { exact: true })).toBeVisible();

    // Listed with its summary; Refresh Stats fills Size and Good.
    await page.goto(`/segments?search=${encodeURIComponent(name)}`);
    const row = page.getByTestId("segment-row").filter({ hasText: name });
    await expect(row).toContainText("Country equals ES");
    await page.getByTestId("refresh-stats").click();
    await expect(page.getByTestId("toast").last()).toContainText("Stats refreshed");
    await expect(row.locator("td").nth(1)).toHaveText(total.toLocaleString("en-GB"));

    // Duplicate opens the copy; delete it from the list.
    await row.getByRole("button", { name: `Duplicate ${name}` }).click();
    await expect(page).toHaveURL(/\/segments\/[0-9a-f-]{36}$/);
    await expect(page.getByTestId("segment-name")).toHaveValue(`Copy of ${name}`);
    await page.goto(`/segments?search=${encodeURIComponent(name)}`);
    await expect(page.getByTestId("segment-row")).toHaveCount(2);
    await page.getByRole("button", { name: `Delete Copy of ${name}` }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
    await expect(page.getByTestId("toast").last()).toContainText("Segment deleted");
    await expect(page.getByTestId("segment-row")).toHaveCount(1);
  });
});
