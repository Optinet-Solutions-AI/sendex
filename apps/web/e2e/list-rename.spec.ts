import { expect, test } from "@playwright/test";
import { cleanupE2eLists, seedE2eList } from "./helpers/db";

const PREFIX = "E2E Rename";

/** D4-27: a list is renamed from its page with the pencil, as a campaign is. */
test.describe("rename a list", () => {
  test.describe.configure({ mode: "serial" });
  const cleanup = () => cleanupE2eLists(PREFIX, "+447700900");
  test.beforeAll(cleanup);
  test.afterAll(cleanup);

  test("the pencil renames a list; Escape leaves it unchanged", async ({ page }) => {
    const id = await seedE2eList(`${PREFIX} Copy of UK`);
    await page.goto(`/lists/${id}`);
    await expect(page.getByTestId("list-name")).toHaveText(`${PREFIX} Copy of UK`);

    await page.getByRole("button", { name: "Rename list" }).click();
    await page.getByLabel("List name").fill(`${PREFIX} UK_ZEN_2`);
    await page.getByLabel("List name").press("Enter");
    await expect(page.getByTestId("list-name")).toHaveText(`${PREFIX} UK_ZEN_2`);

    await page.reload();
    await expect(page.getByTestId("list-name")).toHaveText(`${PREFIX} UK_ZEN_2`);

    await page.getByRole("button", { name: "Rename list" }).click();
    await page.getByLabel("List name").fill("Something else");
    await page.getByLabel("List name").press("Escape");
    await expect(page.getByTestId("list-name")).toHaveText(`${PREFIX} UK_ZEN_2`);

    await page.goto("/lists");
    await expect(page.getByText(`${PREFIX} UK_ZEN_2`)).toBeVisible();
  });
});
