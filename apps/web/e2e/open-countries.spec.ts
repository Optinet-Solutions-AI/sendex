import { expect, test } from "@playwright/test";

/**
 * Only some countries are open (D4-19). The e2e server opens the United Kingdom, Spain,
 * Germany and Malta (`NEXT_PUBLIC_OPEN_COUNTRIES` in playwright.config.ts), so France stands
 * for a closed country: it stays in every "pick a country" dropdown, greyed out and not
 * selectable, and the server refuses it as well.
 */

const HINT = "Only United Kingdom, Spain, Germany and Malta are open for now.";

test.describe("open countries", () => {
  test("New Campaign shows a closed country but does not let it be picked or saved", async ({
    page,
  }) => {
    await page.goto("/campaigns");
    await page.getByTestId("new-campaign").click();
    const dialog = page.getByRole("dialog", { name: "New Campaign" });
    const country = dialog.getByLabel("Country");

    await expect(country.locator('option[value="FR"]')).toBeDisabled();
    await expect(country.locator('option[value="GB"]')).toBeEnabled();
    await expect(country.locator('option[value="ES"]')).toBeEnabled();
    await expect(dialog.getByTestId("open-countries-hint")).toContainText(HINT);

    // Even with the browser's block taken off, the server says no.
    await country.locator('option[value="FR"]').evaluate((o) => o.removeAttribute("disabled"));
    await country.selectOption("FR");
    await dialog.getByLabel("Name").fill(`E2E Closed country ${Date.now()}`);
    await dialog.getByRole("button", { name: "Create campaign" }).click();
    await expect(dialog).toContainText("France is not open yet.");
    await expect(page).toHaveURL(/\/campaigns$/);
  });

  test("Send Single SMS shows a closed country but does not let it be picked", async ({ page }) => {
    await page.goto("/routes/testing");
    await page.getByTestId("open-send-single").click();
    const form = page.getByTestId("send-single-form");
    const country = form.getByTestId("single-country");

    await expect(country.locator('option[value="FR"]')).toBeDisabled();
    await expect(country.locator('option[value="GB"]')).toBeEnabled();
    await expect(form.getByTestId("open-countries-hint")).toContainText(HINT);
  });

  test("List upload shows a closed country but does not let it be picked", async ({ page }) => {
    await page.goto("/lists/upload");
    await page.getByRole("button", { name: "Paste CSV" }).click();
    await page.getByLabel("Paste phone numbers, one per line").fill("447700900123");
    await page.getByRole("button", { name: "Upload", exact: true }).click();
    await expect(page.getByTestId("import-rows")).toHaveText("1 rows");
    await expect(page.getByTestId("open-countries-hint")).toContainText(HINT);

    await page.getByRole("combobox", { name: "Fixed Country" }).click();
    await expect(page.getByRole("option", { name: /France/ })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await expect(page.getByRole("option", { name: /United Kingdom/ })).not.toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await page.getByRole("option", { name: /United Kingdom/ }).click();
    await expect(page.getByRole("combobox", { name: "Fixed Country" })).toContainText(
      "United Kingdom",
    );
  });
});
