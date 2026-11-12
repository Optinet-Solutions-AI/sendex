import { expect, test } from "@playwright/test";

/** D4-10: the campaigns list sorts by a column header; the sort stays in the URL with the filters. */
test("sorting the campaigns list by Sent, then reversing it", async ({ page }) => {
  await page.goto("/campaigns");
  const sentHeader = page.locator("th").filter({ has: page.getByTestId("sort-sent") });
  await expect(sentHeader).toHaveAttribute("aria-sort", "none");

  // Sent column values as numbers, in table order.
  const sentValues = async () =>
    (await page.getByTestId("campaign-row").locator("td:nth-child(6)").allTextContents()).map((t) =>
      Number(t.replace(/[^\d]/g, "") || "0"),
    );

  await page.getByTestId("sort-sent").click();
  await expect(page).toHaveURL(/[?&]sort=sent(&|$)/);
  await expect(sentHeader).toHaveAttribute("aria-sort", "descending");
  const desc = await sentValues();
  expect(desc.length).toBeGreaterThan(1);
  expect(desc).toEqual([...desc].sort((a, b) => b - a));

  await page.getByTestId("sort-sent").click();
  await expect(page).toHaveURL(/[?&]dir=asc(&|$)/);
  await expect(sentHeader).toHaveAttribute("aria-sort", "ascending");
  const asc = await sentValues();
  expect(asc).toEqual([...asc].sort((a, b) => a - b));

  // Applying a filter keeps the sort.
  await page.getByRole("button", { name: "Filters" }).click();
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page).toHaveURL(/[?&]sort=sent(&|$)/);
  await expect(sentHeader).toHaveAttribute("aria-sort", "ascending");
});
