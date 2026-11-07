/**
 * Billing rules and form schemas. Pure: money is a bigint of micro-EUR
 * (1 EUR = 1_000_000) everywhere, the ledger in `packages/db` is the source of
 * truth and nothing here does I/O.
 */
import { z } from "zod";

export const MICRO_PER_EUR = 1_000_000n;

export const LEDGER_KINDS = ["deposit", "debit", "refund", "adjustment"] as const;
export type LedgerKind = (typeof LEDGER_KINDS)[number];

export const DEPOSIT_METHODS = ["wire", "crypto", "manual"] as const;
export type DepositMethod = (typeof DEPOSIT_METHODS)[number];

export const MAX_LOW_BALANCE_EMAILS = 5;

// ---------------------------------------------------------------------------
// Money formatting and parsing
// ---------------------------------------------------------------------------

const groupThousands = new Intl.NumberFormat("en-GB", { useGrouping: true });

/**
 * "€4,988.31" from micro-EUR, rounded to the cent half away from zero.
 * Negative amounts (debits) render as "-EUR 0.04".
 */
export function formatEur(micro: bigint): string {
  const negative = micro < 0n;
  const abs = negative ? -micro : micro;
  // Round to cents: 1 cent = 10_000 micro.
  const cents = (abs + 5_000n) / 10_000n;
  const whole = cents / 100n;
  const frac = cents % 100n;
  const body = `${groupThousands.format(whole)}.${frac.toString().padStart(2, "0")}`;
  return `${negative ? "-" : ""}€${body}`;
}

const EUR_PATTERN = /^(\d{1,3}(?:,\d{3})*|\d+)(?:\.(\d{1,6}))?$/;

/**
 * Parse a non-negative decimal EUR string ("25", "25.50", "1,234.56") into micro-EUR
 * without going through a float. Throws on anything else or on more than six decimals.
 */
export function eurToMicro(amount: string | number): bigint {
  const text = typeof amount === "number" ? amount.toString() : amount.trim();
  const match = EUR_PATTERN.exec(text);
  if (!match) throw new Error(`"${text}" is not a EUR amount`);
  const whole = BigInt((match[1] ?? "0").replace(/,/g, ""));
  const fraction = (match[2] ?? "").padEnd(6, "0");
  return whole * MICRO_PER_EUR + BigInt(fraction);
}

/** `eurToMicro` that returns null instead of throwing, for Zod refinements. */
function tryEurToMicro(amount: string): bigint | null {
  try {
    return eurToMicro(amount);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Low balance alert
// ---------------------------------------------------------------------------

export interface LowBalanceInput {
  balanceMicro: bigint;
  /** Null when the organisation has not set a threshold. */
  thresholdMicro: bigint | null;
  /** When the current dip was last alerted; null once the balance recovered. */
  alertedAt: Date | null;
  now: Date;
}

export type LowBalanceDecision =
  /** Send the alert and store `alertedAt`. */
  | { action: "alert"; alertedAt: Date }
  /** Balance is back at or above the threshold (or the threshold is gone): clear `alertedAt`. */
  | { action: "rearm" }
  | { action: "none" };

/**
 * Fires once per dip: alert when the balance is strictly below the threshold and no alert
 * has been sent since the balance was last at or above it. Once the balance recovers the
 * stored `alertedAt` is cleared (rearm) so the next dip alerts again.
 */
export function shouldAlertLowBalance(input: LowBalanceInput): LowBalanceDecision {
  const armed = input.alertedAt === null;
  if (input.thresholdMicro === null) return armed ? { action: "none" } : { action: "rearm" };
  const below = input.balanceMicro < input.thresholdMicro;
  if (below) return armed ? { action: "alert", alertedAt: input.now } : { action: "none" };
  return armed ? { action: "none" } : { action: "rearm" };
}

// ---------------------------------------------------------------------------
// Form schemas
// ---------------------------------------------------------------------------

/** A strictly positive EUR amount with at most two decimals, parsed to micro-EUR. */
const positiveEurSchema = z
  .string()
  .trim()
  .regex(/^(\d{1,3}(?:,\d{3})*|\d+)(?:\.\d{1,2})?$/, "Enter an amount such as 25 or 25.50")
  .transform((value, ctx) => {
    const micro = tryEurToMicro(value);
    if (micro === null || micro <= 0n) {
      ctx.addIssue({ code: "custom", message: "Amount must be greater than zero" });
      return z.NEVER;
    }
    return micro;
  });

/** A non-negative EUR amount, blank meaning "not set". */
const optionalEurSchema = z.union([z.string(), z.null(), z.undefined()]).transform((value, ctx) => {
  const text = (value ?? "").trim();
  if (text === "") return null;
  if (!/^(\d{1,3}(?:,\d{3})*|\d+)(?:\.\d{1,2})?$/.test(text)) {
    ctx.addIssue({ code: "custom", message: "Enter an amount such as 100 or 100.50" });
    return z.NEVER;
  }
  const micro = tryEurToMicro(text);
  if (micro === null) {
    ctx.addIssue({ code: "custom", message: "Enter an amount such as 100 or 100.50" });
    return z.NEVER;
  }
  return micro;
});

/** A non-negative integer, blank meaning "not set". */
const optionalIntSchema = z
  .union([z.string(), z.number(), z.null(), z.undefined()])
  .transform((value, ctx) => {
    if (value === null || value === undefined) return null;
    const text = String(value).trim();
    if (text === "") return null;
    if (!/^\d+$/.test(text)) {
      ctx.addIssue({ code: "custom", message: "Enter a whole number" });
      return z.NEVER;
    }
    const n = Number.parseInt(text, 10);
    if (!Number.isSafeInteger(n)) {
      ctx.addIssue({ code: "custom", message: "Number is too large" });
      return z.NEVER;
    }
    return n;
  });

const optionalNote = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((value) => {
    const text = (value ?? "").trim();
    return text === "" ? null : text;
  })
  .pipe(z.string().max(500, "Note is too long").nullable());

export interface DepositInput {
  amountMicro: bigint;
  method: DepositMethod;
  reference: string;
  note: string | null;
}

/** The manual deposit form ("Fund your account"); parses the amount to micro-EUR. */
export const depositSchema = z
  .object({
    amountEur: positiveEurSchema,
    method: z.enum(DEPOSIT_METHODS),
    reference: z.string().trim().min(1, "Reference is required").max(100, "Reference is too long"),
    note: optionalNote,
  })
  .transform(
    (value): DepositInput => ({
      amountMicro: value.amountEur,
      method: value.method,
      reference: value.reference,
      note: value.note,
    }),
  );
export type DepositFormInput = z.input<typeof depositSchema>;

export interface BillingSettingsInput {
  lowBalanceThresholdMicro: bigint | null;
  lowBalanceEmails: string[];
  dailyMessageCap: number | null;
  dailySpendCapMicro: bigint | null;
}

/** Low balance alert and daily caps (Settings → Billing); parses amounts to micro-EUR. */
export const billingSettingsSchema = z
  .object({
    lowBalanceThresholdEur: optionalEurSchema,
    lowBalanceEmails: z
      .array(z.string().trim())
      .transform((emails) => emails.filter((e) => e !== ""))
      .pipe(
        z
          .array(z.email("Enter a valid email address"))
          .max(MAX_LOW_BALANCE_EMAILS, `At most ${MAX_LOW_BALANCE_EMAILS} email addresses`),
      ),
    dailyMessageCap: optionalIntSchema,
    dailySpendCapEur: optionalEurSchema,
  })
  .transform(
    (value): BillingSettingsInput => ({
      lowBalanceThresholdMicro: value.lowBalanceThresholdEur,
      lowBalanceEmails: value.lowBalanceEmails,
      dailyMessageCap: value.dailyMessageCap,
      dailySpendCapMicro: value.dailySpendCapEur,
    }),
  );
export type BillingSettingsFormInput = z.input<typeof billingSettingsSchema>;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

/** Filters of the Transactions tab and its CSV export. */
export const ledgerFilterSchema = z.object({
  kind: z.enum(LEDGER_KINDS).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});
export type LedgerFilter = z.infer<typeof ledgerFilterSchema>;

export function isLedgerKind(value: unknown): value is LedgerKind {
  return typeof value === "string" && (LEDGER_KINDS as readonly string[]).includes(value);
}
