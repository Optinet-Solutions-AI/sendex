import { can } from "@sendex/core";
import { db, getSettings } from "@sendex/db";
import Link from "next/link";
import { AuthError, requireAction } from "../../../../lib/auth";
import { eurDecimal, formatDateTime } from "../../../../lib/format";
import { AuthErrorView } from "../../require-org";
import { BillingSettingsForm } from "./billing-settings-form";

export const dynamic = "force-dynamic";

/** Low balance alert and daily caps. Readable by every role, editable by owners. */
export default async function BillingSettingsPage() {
  let ctx: Awaited<ReturnType<typeof requireAction>>;
  try {
    ctx = await requireAction("settings.view");
  } catch (error) {
    if (error instanceof AuthError) return <AuthErrorView error={error} />;
    throw error;
  }
  const settings = await getSettings(db(), ctx.organisationId);
  return (
    <section className="max-w-2xl">
      <p className="text-sm text-neutral-500">
        <Link href="/settings" className="hover:underline">
          Settings
        </Link>{" "}
        / Billing
      </p>
      <h1 className="mt-1 text-2xl font-semibold">Billing settings</h1>
      <p className="mt-2 text-sm text-neutral-600">
        Get an email when the balance drops below a threshold, and cap how much the organisation can
        send or spend per day. The alert fires once per dip and arms again when the balance
        recovers.
      </p>
      <p className="mt-2 text-sm text-neutral-600" data-testid="caps-explainer">
        The daily caps count messages created and money debited since midnight UTC, across every
        campaign of the organisation. When a cap is reached the sending engine sends what still
        fits, refuses the rest of the lap (the lap row shows the refused count), pauses the campaign
        and raises an alert in the dashboard banner. Raise the cap here, or wait for the next UTC
        day, then resume the campaign. Every change to these settings is written to the audit log.
      </p>
      {settings.lowBalanceAlertedAt ? (
        <p className="mt-2 text-sm text-amber-800" data-testid="alert-state">
          Low balance alert last sent {formatDateTime(settings.lowBalanceAlertedAt)}; it will fire
          again after the balance goes back above the threshold.
        </p>
      ) : null}
      <div className="mt-6">
        <BillingSettingsForm
          canManage={can(ctx.role, "settings.manage")}
          initial={{
            lowBalanceThresholdEur: settings.lowBalanceThresholdMicro
              ? eurDecimal(settings.lowBalanceThresholdMicro)
              : "",
            lowBalanceEmails: settings.lowBalanceEmails.join("\n"),
            dailyMessageCap: settings.dailyMessageCap?.toString() ?? "",
            dailySpendCapEur: settings.dailySpendCapMicro
              ? eurDecimal(settings.dailySpendCapMicro)
              : "",
          }}
        />
      </div>
    </section>
  );
}
