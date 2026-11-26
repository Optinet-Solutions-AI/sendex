/**
 * How each computed figure is worked out (D5-20), in plain words, for the hover explanation
 * on table headers, tiles and cells (`Explained` in @sendex/ui). One wording per figure,
 * shared by every screen. The workings take the numbers already formatted as the screen
 * shows them, so the sum always matches what is on screen, rounding included.
 */
export const FORMULAS = {
  // Sending
  sent: "Sent = SMS the carrier accepted",
  deliveryRate: "Delivery = Delivered ÷ Sent",
  ctr: "CTR = Clicks ÷ Sent",
  clicks: "Clicks = SMS clicked at least once by a person (link previews and scanners left out)",
  cost: "Cost = SMS sent × price per SMS",
  cpc: "CPC = Cost ÷ Clicks",
  // Conversions
  leadRate: "Lead rate = Leads ÷ Sent",
  saleRate: "Sale rate = Sales ÷ Sent",
  sales: "Sales = first deposits (one per SMS, repeat deposits left out)",
  cpl: "CPL = Cost ÷ Leads",
  cps: "CPS = Cost ÷ Sales (first deposits)",
  ctl: "CtL = Leads ÷ Clicks",
  cts: "CtS = Sales ÷ Clicks",
  lts: "Lead → sale = Sales ÷ Leads",
  // Money
  revenue: "Revenue = each first deposit × its offer's deal CPA on the deposit day",
  profit: "Profit = Revenue − Cost",
  roi: "ROI = (Revenue − Cost) ÷ Cost",
  costPerSale: "Cost per sale = Cost ÷ Sales",
  revenuePerSale: "Revenue per sale = Revenue ÷ Sales",
  profitPerSale: "Profit per sale = (Revenue − Cost) ÷ Sales",
  smsPerSale: "SMS per sale = Sent ÷ Sales",
  balance: "Balance = the carriers' balances on your routes (23Telecom), read every minute",
  estimate: "Estimate = SMS planned × price per SMS × parts per SMS",
} as const;

export type FormulaKey = keyof typeof FORMULAS;

/** Where a screen mixes days: cost and sends by send day, sales and revenue by deposit day. */
export const DAY_RULE_NOTE =
  "Sends, clicks, leads and cost count on the day the SMS was sent; sales and revenue on the day of the first deposit.";

export interface WorkingOptions {
  /** True when the figure cannot be computed (e.g. dividing by zero). */
  emptyWhen?: boolean;
  /** What to say instead, e.g. "No SMS sent yet". */
  empty?: string;
}

/** "9 clicks ÷ 190 sent = 4.74%", or the `empty` sentence when it cannot be computed. */
export function workingDivide(
  numerator: string,
  denominator: string,
  result: string,
  options: WorkingOptions = {},
): string {
  if (options.emptyWhen) return options.empty ?? `Nothing to divide by yet, so ${result}`;
  return `${numerator} ÷ ${denominator} = ${result}`;
}

/** "€16,720.00 revenue − €40.00 cost = €16,680.00". */
export function workingMinus(a: string, b: string, result: string): string {
  return `${a} − ${b} = ${result}`;
}

/** "€38.40 + €9.60 = €48.00" (a total of rows), or "Nothing yet = €0.00". */
export function workingSum(parts: readonly string[], result: string): string {
  if (parts.length === 0) return `Nothing yet = ${result}`;
  return `${parts.join(" + ")} = ${result}`;
}

/**
 * Revenue from first deposits: "36 first deposits, on average €240.00 each = €8,640.00"
 * (deposits can earn different CPAs when a deal changes, so the per-deposit figure is an
 * average), "1 first deposit at €250.00 = €250.00", or "No first deposits yet".
 */
export function workingPerSale(sales: number, revenue: string, perSale: string): string {
  if (sales === 0) return "No first deposits yet";
  if (sales === 1) return `1 first deposit at ${perSale} = ${revenue}`;
  return `${sales.toLocaleString("en-GB")} first deposits, on average ${perSale} each = ${revenue}`;
}
