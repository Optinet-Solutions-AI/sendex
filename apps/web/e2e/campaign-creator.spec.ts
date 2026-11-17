import { expect, test } from "@playwright/test";
import { deletePlannedCampaigns, ensureDemoActivity } from "./helpers/demo";

/**
 * The campaign creator (D5-07) on the demo activity (D5-02): by country it ranks the offers
 * and shows the lists never sent to the chosen one first; the last step makes a draft campaign
 * with the list, the offer and the route attached.
 */
test.describe("campaign creator", () => {
  test.beforeAll(async () => {
    ensureDemoActivity();
    await deletePlannedCampaigns();
  });

  test.afterAll(async () => {
    await deletePlannedCampaigns();
  });

  test("by country: ranked offers, never-sent lists first, and a draft campaign at the end", async ({
    page,
  }) => {
    await page.goto("/kpi/list-follow-up");
    await page.getByTestId("open-campaign-creator").click();
    const creator = page.getByTestId("campaign-creator");
    await expect(creator.getByTestId("creator-period")).toContainText("Showing data for");

    // Rank on a period that covers every demo send.
    await creator.getByRole("button", { name: "Last 12 months" }).click();
    await expect(creator.getByTestId("creator-period")).toContainText("–");
    await creator.getByTestId("creator-flow-country").click();

    await creator.getByRole("combobox", { name: "Country" }).click();
    await page.getByRole("option", { name: "United Kingdom" }).click();
    const offers = creator.getByTestId("creator-offers");
    await expect(offers).toContainText("Rolling Slots");
    await expect(offers).toContainText("Trixino");
    await expect(creator.getByTestId("creator-next")).toBeDisabled();
    await offers.getByTestId("creator-choice").filter({ hasText: "Trixino" }).click();
    await creator.getByTestId("creator-next").click();

    // UK_DIM_1 only went to other offers, so it is offered first, marked as never sent.
    const lists = creator.getByTestId("creator-lists");
    const first = lists.getByTestId("creator-choice").first();
    await expect(first).toContainText("Never sent to Trixino");
    const dim = lists.getByTestId("creator-choice").filter({ hasText: "UK_DIM_1" });
    await expect(dim).toContainText("Never sent to Trixino");
    await expect(
      lists.getByTestId("creator-choice").filter({ hasText: "UK_ZEN_1" }),
    ).not.toContainText("Never sent");
    await dim.click();
    await creator.getByTestId("creator-next").click();

    await expect(creator.getByTestId("creator-summary")).toContainText("Trixino → UK_DIM_1");
    await expect(creator.getByTestId("creator-add")).toBeDisabled();
    await creator.getByRole("combobox", { name: "Route" }).click();
    // The price has four decimals, as on the campaign page (D5-10).
    await page.getByRole("option", { name: /Route 724 · GB \(€\d\.\d{4}\/SMS\)/ }).click();
    await creator.getByTestId("creator-add").click();

    await expect(page.getByTestId("toast").last()).toContainText("Campaign added");
    await expect(creator).toBeHidden();

    // The draft is in the campaigns list with its list, offer and route.
    await page.goto("/campaigns");
    await page.getByRole("link", { name: "Trixino → UK_DIM_1" }).first().click();
    await expect(page).toHaveURL(/\/campaigns\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Trixino → UK_DIM_1");
  });

  test("by list: pick a list, then an offer it never got", async ({ page }) => {
    await page.goto("/kpi/list-follow-up");
    await page.getByTestId("open-campaign-creator").click();
    const creator = page.getByTestId("campaign-creator");
    await creator.getByRole("button", { name: "Last 12 months" }).click();
    await creator.getByTestId("creator-flow-list").click();

    const all = creator.getByTestId("creator-all-lists");
    await expect(all.getByTestId("creator-choice").filter({ hasText: "UK_ZEN_3" })).toContainText(
      "Never sent",
    );
    await all.getByTestId("creator-choice").filter({ hasText: "UK_ZEN_3" }).click();
    await creator.getByTestId("creator-next").click();

    const offers = creator.getByTestId("creator-offers");
    await expect(
      offers.getByTestId("creator-choice").filter({ hasText: "Rolling Slots" }),
    ).toContainText("Never sent to this list");
    await offers.getByTestId("creator-choice").filter({ hasText: "Rolling Slots" }).click();
    await creator.getByTestId("creator-next").click();
    await expect(creator.getByTestId("creator-summary")).toContainText("Rolling Slots → UK_ZEN_3");

    // Back goes one step at a time.
    await creator.getByRole("button", { name: "Back" }).click();
    await expect(creator.getByTestId("creator-offers")).toBeVisible();
  });
});
