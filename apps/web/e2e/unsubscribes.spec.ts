import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { cleanupE2eSuppressions } from "./helpers/db";

const FIXTURE = join(__dirname, "fixtures", "es-numbers.csv");
/** The spec adds and uploads numbers starting with this; nothing else uses it. */
const E164_PREFIX = "+34699";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await cleanupE2eSuppressions([E164_PREFIX, "+34622000", "+3491234567", "+3493234567"]);
});

test.afterAll(async () => {
  await cleanupE2eSuppressions([E164_PREFIX, "+34622000", "+3491234567", "+3493234567"]);
});

/**
 * Contacts › Unsubscribe: add numbers by hand, see them in the Numbers tab, resubscribe one,
 * upload a suppression file with a column pick, and read the two API URLs.
 */
test.describe("unsubscribe", () => {
  test("add number, resubscribe, upload a file and the API tab", async ({ page }) => {
    await page.goto("/unsubscribes");
    await expect(page.getByRole("heading", { level: 1, name: "Unsubscribe" })).toBeVisible();

    await page.getByRole("button", { name: "Add number" }).click();
    await page.getByTestId("add-numbers").fill("+34 699 000 001\n34699000002\njunk");
    await page.getByTestId("add-submit").click();
    await expect(page.getByTestId("toast").last()).toContainText("2 numbers unsubscribed");
    await expect(page.getByTestId("unsub-row").filter({ hasText: "+34699000001" })).toBeVisible();
    await expect(page.getByTestId("unsub-row").filter({ hasText: "+34699000002" })).toContainText(
      "Added by hand",
    );

    await page.getByRole("button", { name: "Resubscribe" }).click();
    await page.getByTestId("resubscribe-numbers").fill("+34699000002");
    await page.getByTestId("resubscribe-submit").click();
    await expect(page.getByTestId("toast").last()).toContainText("1 number resubscribed");
    await expect(page.getByTestId("unsub-row").filter({ hasText: "+34699000002" })).toHaveCount(0);

    // Upload the list fixture as a suppression file: 16 are international; the three national
    // numbers and "12345" are rejected (no default country on an account-wide list).
    await page.getByRole("button", { name: "Upload unsubscribes" }).click();
    await page.getByTestId("unsub-file").setInputFiles(FIXTURE);
    await expect(page.getByTestId("unsub-column")).toBeVisible();
    await page.getByTestId("unsub-upload-submit").click();
    await expect(page.getByTestId("toast").last()).toContainText("16 numbers unsubscribed");
    await page.goto("/unsubscribes?tab=imports");
    const fileRow = page.getByTestId("unsub-import-row").filter({ hasText: "es-numbers.csv" });
    await expect(fileRow).toContainText("16");
    await expect(page.getByTestId("unsub-imports")).toContainText("1");

    await page.goto("/unsubscribes?tab=api");
    await expect(page.getByTestId("unsub-api")).toContainText("type=rm-fk&fk={{{dynamic}}}");
    await expect(page.getByTestId("unsub-api")).toContainText("type=rm-u&number={{{number}}}");
  });
});
