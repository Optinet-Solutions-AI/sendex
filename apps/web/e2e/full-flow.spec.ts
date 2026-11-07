import { expect, type Page, test } from "@playwright/test";
import { cancelQueuedLaps, cleanupE2eFlow, firstShortCode, flushListByName } from "./helpers/db";
import { type RunningWorker, startWorker } from "./helpers/worker";

const PREFIX = "E2E Flow";
const TEST_SIZE = 20;
const WORKER_PORT = 4300;

/**
 * The whole first version in one run (D2-20): a campaign built on the screens is sent by the
 * real worker through the FakeProvider, the page shows the progress and the balance debit,
 * a click reported the way the links service reports it shows up on the lap. Needs the local
 * Postgres (DATABASE_URL) and Redis (REDIS_URL); skipped where there is no Redis, as on CI.
 */
test.describe("full flow: send, progress, click", () => {
  test.describe.configure({ mode: "serial" });
  const redisUrl = process.env.REDIS_URL ?? "";
  const databaseUrl = process.env.DATABASE_URL ?? "";
  test.skip(!redisUrl || !databaseUrl, "needs REDIS_URL and DATABASE_URL for the worker");
  let worker: RunningWorker;

  test.beforeAll(async () => {
    await cleanupE2eFlow(PREFIX);
    // Laps other specs left queued would be sent by this worker's dispatcher.
    await cancelQueuedLaps();
    await flushListByName("Roy Boy_ES_14092026_Batch2");
    worker = await startWorker({ port: WORKER_PORT, databaseUrl, redisUrl });
  });

  test.afterAll(async () => {
    await worker?.stop();
    await cleanupE2eFlow(PREFIX);
  });

  test("a campaign is sent, the page shows the progress and the debit, a click is counted", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const name = `${PREFIX} ${Date.now()}`;
    await page.goto("/campaigns");
    const balanceBefore = await readBalance(page);

    await page.getByTestId("new-campaign").click();
    const dialog = page.getByRole("dialog", { name: "New Campaign" });
    await dialog.getByLabel("Name").fill(name);
    await dialog.getByLabel("Country").selectOption("ES");
    await dialog.getByRole("button", { name: "Create campaign" }).click();
    await expect(page).toHaveURL(/\/campaigns\/[0-9a-f-]{36}$/);
    const campaignId = page.url().slice(-36);

    // Sender ids, the seeded list, a text with the tracked link and the link itself.
    const sidSelect = page.getByTestId("sid-group-select");
    const groupValue = await sidSelect
      .locator("option", { hasText: "ES Casino" })
      .getAttribute("value");
    if (!groupValue) throw new Error("seeded group ES Casino not found");
    await sidSelect.selectOption(groupValue);
    await page.getByRole("button", { name: "Lists", exact: true }).click();
    await page
      .getByTestId("lists-panel")
      .getByLabel("Roy Boy_ES_14092026_Batch2", { exact: true })
      .check();
    await expect(page.getByTestId("footer-contacts")).toHaveText("1,738");

    await page.getByRole("button", { name: "Ad Texts", exact: true }).click();
    await page.getByTestId("add-texts").click();
    const editor = page.getByRole("dialog", { name: "Add Ad Texts" });
    await editor.getByTestId("ad-text-input").fill("Gira y gana hoy en {{domain}}");
    await editor.getByTestId("save-ad-text").click();
    await expect(editor).toBeHidden();

    await page.getByRole("button", { name: "Offers", exact: true }).click();
    const linksPanel = page.getByTestId("links-panel");
    await linksPanel.getByLabel("Offer").selectOption({ label: "Rolling Slots" });
    await linksPanel.getByRole("button", { name: "Add Offer" }).click();
    await expect(linksPanel).toContainText("Rolling Slots");

    // A small test lap on route 405 (EUR 0.025): 20 SMS for EUR 0.50.
    await page.getByRole("switch", { name: "Advanced Settings" }).click();
    await page.getByTestId("test-size").fill(String(TEST_SIZE));
    await page.getByTestId("test-size").blur();
    await page.getByRole("button", { name: "Routes", exact: true }).click();
    await page.getByTestId("route-405").check();
    await expect(page.getByTestId("footer-sms")).toHaveText(String(TEST_SIZE));
    await expect(page.getByTestId("footer-cost")).toHaveText("~€0.50");
    await page.getByTestId("send-button").click();
    await expect(page.getByTestId("lap-row")).toHaveCount(1);

    // The worker picks the lap up, sends through the FakeProvider and the page catches up.
    await expect
      .poll(
        async () => {
          await page.reload();
          return page.getByTestId("lap-row").first().getAttribute("data-lap-status");
        },
        { timeout: 90_000, intervals: [2_000] },
      )
      .toBe("done");
    await expect(page.getByTestId("sending-progress")).toContainText(`${TEST_SIZE} / ${TEST_SIZE}`);
    await expect(page.getByTestId("total-sent")).toHaveText(String(TEST_SIZE));
    await expect(page.getByTestId("lap-sent")).toHaveText(String(TEST_SIZE));

    // Every message was debited: EUR 0.50 less on the balance in the header.
    const balanceAfter = await readBalance(page);
    expect(Math.round((balanceBefore - balanceAfter) * 100)).toBe(50);

    // A click, reported the way the links service does it, reaches the lap and the CTR.
    const shortCode = await firstShortCode(campaignId);
    const res = await fetch(`${worker.baseUrl}/internal/clicks`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-internal-secret": worker.secret },
      body: JSON.stringify({
        clicks: [
          {
            shortCode,
            clickedAt: new Date().toISOString(),
            ip: "203.0.113.9",
            userAgent: "Mozilla/5.0 (e2e)",
            country: "ES",
          },
        ],
      }),
    });
    expect(res.status, await res.text()).toBe(202);
    await expect
      .poll(
        async () => {
          await page.reload();
          return page.getByTestId("lap-clicks").first().textContent();
        },
        { timeout: 30_000, intervals: [1_000] },
      )
      .toBe("1");
    await expect(page.getByTestId("total-clicks")).toHaveText("1");
    await expect(page.getByTestId("total-ctr")).toHaveText("5.00%");
  });
});

/** "Balance: €4,957.11" in the header → 4957.11. */
async function readBalance(page: Page): Promise<number> {
  const text = (await page.getByTestId("header-balance").textContent()) ?? "";
  const match = text.replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  if (!match) throw new Error(`no balance in header: "${text}"`);
  return Number(match[0]);
}
