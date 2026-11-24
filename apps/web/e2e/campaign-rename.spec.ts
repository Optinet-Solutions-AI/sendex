import { expect, test } from "@playwright/test";

/**
 * Renaming a campaign (D4-26): a duplicate starts as "Copy of …"; the pencil next to the name
 * on the campaign page renames it, and the new name stays after a reload.
 */
test("a duplicated campaign can be renamed from its page", async ({ page }) => {
  const stamp = Date.now();
  await page.goto("/campaigns");
  await page.getByTestId("new-campaign").click();
  const dialog = page.getByRole("dialog", { name: "New Campaign" });
  await dialog.getByLabel("Name").fill(`E2E Rename ${stamp}`);
  await dialog.getByLabel("Country").selectOption("ES");
  await dialog.getByRole("button", { name: "Create campaign" }).click();
  await expect(page).toHaveURL(/\/campaigns\/[0-9a-f-]{36}$/);

  await page.getByRole("button", { name: "Campaign actions" }).click();
  await page.getByRole("menuitem", { name: "Duplicate" }).click();
  await expect(page.getByTestId("campaign-name")).toHaveText(`Copy of E2E Rename ${stamp}`);

  await page.getByRole("button", { name: "Rename campaign" }).click();
  const field = page.getByRole("textbox", { name: "Campaign name" });
  await field.fill(`E2E Renamed ${stamp}`);
  await page.getByRole("button", { name: "Save name" }).click();
  await expect(page.getByTestId("campaign-name")).toHaveText(`E2E Renamed ${stamp}`);

  await page.reload();
  await expect(page.getByTestId("campaign-name")).toHaveText(`E2E Renamed ${stamp}`);

  // Escape leaves the name as it was.
  await page.getByRole("button", { name: "Rename campaign" }).click();
  await page.getByRole("textbox", { name: "Campaign name" }).fill("Not this one");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("campaign-name")).toHaveText(`E2E Renamed ${stamp}`);
});
