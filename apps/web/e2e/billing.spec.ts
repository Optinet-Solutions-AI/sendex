import { expect, test } from "@playwright/test";

/**
 * Billing and audit screens as the seeded development owner (`SENDEX_DEV_AUTH=1`,
 * organisation "external", seeded with a EUR 4,988.31 deposit). Each run records a deposit
 * with a unique reference, so the spec is repeatable; the balance simply grows across runs.
 */

function eur(amount: number): string {
  return `EUR ${amount.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function parseEur(text: string): number {
  const match = /EUR\s([\d,]+\.\d{2})/.exec(text);
  if (!match?.[1]) throw new Error(`no EUR amount in "${text}"`);
  return Number.parseFloat(match[1].replace(/,/g, ""));
}

test.describe("billing", () => {
  test("balance in the header, a manual deposit, the tabs and the audit entry", async ({
    page,
    request,
  }) => {
    await page.goto("/");
    const header = page.getByTestId("header-balance");
    await expect(header).toContainText(/^Balance: EUR [\d,]+\.\d{2}$/);
    // The seed deposits EUR 4,988.31; other specs and earlier runs move it, so only its shape is fixed.
    const before = parseEur((await header.textContent()) ?? "");
    const nav = page.getByRole("navigation", { name: "Main" });
    await nav.hover();
    await nav.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(nav.getByRole("link", { name: "Logs", exact: true })).toBeVisible();
    await page.mouse.move(600, 300);

    await header.click();
    await expect(page).toHaveURL(/\/billing$/);
    await expect(page.getByRole("heading", { level: 1, name: "Billing" })).toBeVisible();
    await expect(page.getByTestId("billing-balance")).toHaveText(eur(before));
    await expect(page.getByRole("button", { name: /Pay by card/ })).toBeDisabled();
    await expect(page.getByRole("button", { name: /PayPal/ })).toBeDisabled();

    // Record a EUR 25 manual deposit with a unique reference.
    const reference = `E2E-${Date.now()}`;
    await page.getByLabel("Amount (EUR)").fill("25");
    await page.getByLabel("Method").selectOption("manual");
    await page.getByLabel("Reference").fill(reference);
    await page.getByLabel("Note").fill("Playwright deposit");
    await page.getByTestId("record-deposit").click();
    await expect(page.getByTestId("toast")).toContainText("Deposit recorded");

    const after = Math.round((before + 25) * 100) / 100;
    await expect(page.getByTestId("header-balance")).toHaveText(`Balance: ${eur(after)}`);
    await expect(page.getByTestId("billing-balance")).toHaveText(eur(after));

    // The Deposits tab (default) lists it.
    const depositRow = page.getByRole("row", { name: new RegExp(reference) });
    await expect(depositRow).toBeVisible();
    await expect(depositRow).toContainText("EUR 25.00");
    await expect(depositRow).toContainText("Playwright deposit");

    // The same reference is refused.
    await page.getByLabel("Amount (EUR)").fill("1");
    await page.getByLabel("Reference").fill(reference);
    await page.getByTestId("record-deposit").click();
    await expect(page.getByTestId("fund-panel").getByRole("alert")).toContainText(
      "already been recorded",
    );
    await expect(page.getByTestId("header-balance")).toHaveText(`Balance: ${eur(after)}`);

    // Transactions tab: filter by kind and export.
    await page.getByRole("tab", { name: "Transactions" }).click();
    await expect(page).toHaveURL(/tab=transactions/);
    await page.getByLabel("Kind").selectOption("deposit");
    await page.getByRole("button", { name: "Filter" }).click();
    await expect(page).toHaveURL(/kind=deposit/);
    await expect(page.getByRole("row", { name: new RegExp(reference) })).toContainText("deposit");
    const csv = await request.get("/billing/export?report=transactions&kind=deposit");
    expect(csv.ok()).toBe(true);
    expect(csv.headers()["content-type"]).toContain("text/csv");
    const body = await csv.text();
    expect(body.split("\r\n")[0]).toBe(
      "Date,Kind,Amount (EUR),Reference type,Reference,Note,Entry id",
    );
    expect(body).toContain(`deposit,25.00,manual,${reference},Playwright deposit,`);

    // Summary tab: today's row includes the deposit.
    await page.getByRole("tab", { name: "Summary" }).click();
    await expect(page).toHaveURL(/tab=summary/);
    const today = new Date().toISOString().slice(0, 10);
    const summaryRow = page.getByTestId(`summary-row-${today}`);
    await expect(summaryRow).toBeVisible();
    const deposits = parseEur((await summaryRow.getByRole("cell").nth(1).textContent()) ?? "");
    expect(deposits).toBeGreaterThanOrEqual(25);
    await expect(page.getByRole("link", { name: "Download report CSV" })).toBeVisible();
    const report = await request.get(`/billing/export?report=summary&from=${today}&to=${today}`);
    expect(report.ok()).toBe(true);
    expect((await report.text()).split("\r\n")[1]?.startsWith(`${today},`)).toBe(true);

    // The audit log has the balance.deposit entry by the development user.
    await page.goto("/audit");
    await expect(page.getByRole("heading", { level: 1, name: "Audit log" })).toBeVisible();
    const auditRow = page.getByRole("row", { name: new RegExp(`reference=${reference}`) });
    await expect(auditRow).toBeVisible();
    await expect(auditRow).toContainText("balance.deposit");
    await expect(auditRow).toContainText("Development user");
    await expect(auditRow).toContainText("amountMicro=25000000");

    await page.getByLabel("Action").selectOption("balance.deposit");
    await page.getByRole("button", { name: "Filter" }).click();
    await expect(page).toHaveURL(/action=balance\.deposit/);
    await expect(auditRow).toBeVisible();
    const auditCsv = await request.get("/audit/export?action=balance.deposit");
    expect(auditCsv.ok()).toBe(true);
    expect(await auditCsv.text()).toContain(reference);
  });

  test("the owner can save the low balance alert and daily caps", async ({ page }) => {
    await page.goto("/settings/billing");
    await expect(page.getByRole("heading", { level: 1, name: "Billing settings" })).toBeVisible();
    await page.getByLabel("Alert when the balance drops below (EUR)").fill("100");
    await page.getByLabel(/Send the alert to/).fill("owner@example.com\nfinance@example.com");
    await page.getByLabel("Messages per day").fill("50000");
    await page.getByLabel("Spend per day (EUR)").fill("250.50");
    await page.getByTestId("save-billing-settings").click();
    await expect(page.getByTestId("toast")).toContainText("Billing settings saved");

    await page.reload();
    await expect(page.getByLabel("Alert when the balance drops below (EUR)")).toHaveValue("100.00");
    await expect(page.getByLabel(/Send the alert to/)).toHaveValue(
      "owner@example.com\nfinance@example.com",
    );
    await expect(page.getByLabel("Messages per day")).toHaveValue("50000");
    await expect(page.getByLabel("Spend per day (EUR)")).toHaveValue("250.50");

    await page.goto("/audit?action=settings.update");
    await expect(page.getByRole("row", { name: /section=billing/ }).first()).toBeVisible();
  });
});
