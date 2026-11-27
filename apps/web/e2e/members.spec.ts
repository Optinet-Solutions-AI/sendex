import { expect, test } from "@playwright/test";

/**
 * D5-21: Settings › Members is in the menu for an owner and opens. Under the development
 * sign-in Clerk is off, so the page says members are managed in Clerk (the invite, change and
 * remove logic is covered by lib/members.test.ts against a fake Clerk).
 */
test("an owner finds Members under Settings", async ({ page }) => {
  await page.goto("/settings/members");
  await expect(page.getByRole("heading", { level: 1, name: "Members" })).toBeVisible();
  await expect(page.getByText(/Invite someone by email/)).toBeVisible();
  await expect(page.getByTestId("members-dev-note")).toBeVisible();
});
