"use server";

import {
  type BillingSettingsFormInput,
  billingSettingsSchema,
  type DepositFormInput,
  depositSchema,
} from "@sendex/core";
import {
  DuplicateDepositError,
  db,
  getBalanceMicro,
  recordAudit,
  recordDeposit,
  updateSettings,
} from "@sendex/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AuthError, requireAction } from "../../../lib/auth";
import { assertRecentAuth } from "../../../lib/reauth";

/**
 * Server actions of the billing screens. Each resolves the tenant with `requireAction`,
 * validates with the Zod schemas from `@sendex/core` and returns a result object instead
 * of throwing. Amounts cross the client boundary as decimal strings of micro-EUR because
 * bigint does not serialise.
 */
export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    if (error instanceof DuplicateDepositError) return { ok: false, error: error.message };
    if (error instanceof z.ZodError) {
      return { ok: false, error: error.issues.map((i) => i.message).join("; ") };
    }
    console.error("billing action failed", error instanceof Error ? error.message : error);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

export interface DepositResult {
  entryId: string;
  /** Micro-EUR as a decimal string. */
  amountMicro: string;
  /** The balance after the deposit, micro-EUR as a decimal string. */
  balanceMicro: string;
}

/**
 * Record a manual deposit (wire, crypto or manual). Owner only, and the owner must have
 * signed in recently (`assertRecentAuth`). A repeated reference is rejected by the ledger.
 */
export async function recordDepositAction(
  input: DepositFormInput,
): Promise<ActionResult<DepositResult>> {
  return run(async () => {
    const ctx = await requireAction("balance.deposit");
    await assertRecentAuth();
    const deposit = depositSchema.parse(input);
    const database = db();
    const entry = await recordDeposit(database, ctx.organisationId, {
      ...deposit,
      actorUserId: ctx.userId,
    });
    await recordAudit(database, ctx.organisationId, {
      actorUserId: ctx.userId,
      action: "balance.deposit",
      targetType: "ledger_entry",
      targetId: entry.id,
      details: {
        amountMicro: entry.amountMicro.toString(),
        method: deposit.method,
        reference: deposit.reference,
      },
    });
    const balanceMicro = await getBalanceMicro(database, ctx.organisationId);
    revalidatePath("/", "layout");
    return {
      entryId: entry.id,
      amountMicro: entry.amountMicro.toString(),
      balanceMicro: balanceMicro.toString(),
    };
  });
}

/** Save the low balance alert and daily caps. Owner only. */
export async function updateBillingSettingsAction(
  input: BillingSettingsFormInput,
): Promise<ActionResult<{ saved: true }>> {
  return run(async () => {
    const ctx = await requireAction("settings.manage");
    const settings = billingSettingsSchema.parse(input);
    const database = db();
    await updateSettings(database, ctx.organisationId, settings);
    await recordAudit(database, ctx.organisationId, {
      actorUserId: ctx.userId,
      action: "settings.update",
      targetType: "organisation",
      targetId: ctx.organisationId,
      details: {
        section: "billing",
        lowBalanceThresholdMicro: settings.lowBalanceThresholdMicro?.toString() ?? null,
        lowBalanceEmails: settings.lowBalanceEmails.length,
        dailyMessageCap: settings.dailyMessageCap,
        dailySpendCapMicro: settings.dailySpendCapMicro?.toString() ?? null,
      },
    });
    revalidatePath("/settings/billing");
    return { saved: true as const };
  });
}
