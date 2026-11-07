import { z } from "zod";

/**
 * Numbers Verification (D4-07): lookup statuses, the enrichment rule form, the allowance a
 * rule leaves for a run, verdict rules and the KPI maths. No I/O.
 */

export const LOOKUP_STATUSES = [
  "hlr",
  "mnp",
  "unresolved",
  "local_only",
  "checking",
  "bad",
  "blacklisted",
] as const;
export type LookupStatus = (typeof LOOKUP_STATUSES)[number];

export const LOOKUP_STATUS_LABEL: Record<LookupStatus, string> = {
  hlr: "HLR-checked",
  mnp: "MNP (ported)",
  unresolved: "Unresolved",
  local_only: "Local only",
  checking: "Checking",
  bad: "Bad",
  blacklisted: "Blacklisted",
};

export type LookupVerdict = "good" | "bad" | "none";

/** What a status means for the log's Good / Bad / No verdict columns. */
export function lookupVerdict(status: LookupStatus): LookupVerdict {
  switch (status) {
    case "hlr":
    case "mnp":
    case "local_only":
      return "good";
    case "bad":
    case "blacklisted":
      return "bad";
    case "unresolved":
    case "checking":
      return "none";
  }
}

const country = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/, "Select a country");

export const enrichmentRuleSchema = z.object({
  country,
  dailyLimit: z.coerce.number().int().min(1, "At least one number a day").max(1_000_000),
  /** EUR with up to two decimals. */
  monthlyBudgetEur: z
    .string()
    .trim()
    .regex(/^\d+(?:\.\d{1,2})?$/, "Budget in EUR"),
  onSchedule: z.boolean().default(true),
  afterUpload: z.boolean().default(false),
  asYouSend: z.boolean().default(false),
  includeArchived: z.boolean().default(false),
});
export type EnrichmentRuleInput = z.infer<typeof enrichmentRuleSchema>;

export const hlrVerifySchema = z.object({ listId: z.string().uuid() });

/** "25" → 25_000_000n. */
export function eurToMicroBudget(eur: string): bigint {
  const [whole = "0", frac = ""] = eur.split(".");
  return BigInt(whole) * 1_000_000n + BigInt((frac + "000000").slice(0, 6));
}

export interface RuleAllowanceInput {
  dailyLimit: number;
  monthlyBudgetMicro: bigint;
  /** Numbers already verified for the rule today (UTC). */
  verifiedToday: number;
  /** Micro-EUR already spent on the rule this calendar month. */
  spentThisMonthMicro: bigint;
  /** Lookup price per number for the country; null when there is no price (nothing allowed). */
  priceMicro: bigint | null;
}

/** How many numbers a rule may still verify now, by the daily limit and the monthly budget. */
export function ruleAllowance(input: RuleAllowanceInput): number {
  if (input.priceMicro === null) return 0;
  const byDay = Math.max(0, input.dailyLimit - input.verifiedToday);
  const budgetLeft = input.monthlyBudgetMicro - input.spentThisMonthMicro;
  if (budgetLeft <= 0n) return 0;
  const byBudget = input.priceMicro > 0n ? Number(budgetLeft / input.priceMicro) : byDay;
  return Math.min(byDay, byBudget);
}

export interface VerificationKpis {
  totalUnique: number;
  scanned: number;
  good: number;
  bad: number;
  notChecked: number;
}

/** The KPI strip from the counts of lookup statuses over the organisation's numbers. */
export function verificationKpis(input: {
  totalUnique: number;
  byStatus: Partial<Record<LookupStatus, number>>;
}): VerificationKpis {
  let scanned = 0;
  let good = 0;
  let bad = 0;
  for (const status of LOOKUP_STATUSES) {
    const n = input.byStatus[status] ?? 0;
    scanned += n;
    const verdict = lookupVerdict(status);
    if (verdict === "good") good += n;
    if (verdict === "bad") bad += n;
  }
  return {
    totalUnique: input.totalUnique,
    scanned,
    good,
    bad,
    notChecked: Math.max(0, input.totalUnique - scanned),
  };
}

export interface VerificationLogRow {
  day: string;
  country: string;
  total: number;
  good: number;
  bad: number;
  noVerdict: number;
}

/** The "Download summary" CSV of the verification log. */
export function verificationSummaryCsv(rows: readonly VerificationLogRow[]): string {
  const lines = ["Date,Country,Total,Good,Bad,No verdict"];
  for (const r of rows) {
    lines.push([r.day, r.country, r.total, r.good, r.bad, r.noVerdict].join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}

/** The cost of verifying `count` numbers at a price, for the HLR Verify confirmation. */
export function verificationCostMicro(count: number, priceMicro: bigint | null): bigint | null {
  return priceMicro === null ? null : BigInt(count) * priceMicro;
}
