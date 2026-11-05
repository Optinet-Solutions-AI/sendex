import { type AlertKind, can, isAlertKind, type Role } from "@sendex/core";
import { db, listOpenAlerts } from "@sendex/db";
import Link from "next/link";
import { formatDateTime } from "../../lib/format";
import { AcknowledgeAlertButton } from "./acknowledge-alert-button";

const KIND_LABELS: Record<AlertKind, string> = {
  daily_message_cap: "Daily message cap",
  daily_spend_cap: "Daily spend cap",
  send_spike: "Sending spike",
  low_balance: "Low balance",
};

function kindLabel(kind: string): string {
  return isAlertKind(kind) ? KIND_LABELS[kind] : kind;
}

/**
 * Open alerts of the organisation (D3-11) as a banner above every dashboard page: a daily
 * cap reached, a sending spike, a low balance. Owners acknowledge them here; the settings
 * link is where a cap gets raised before the paused campaign is resumed.
 */
export async function AlertsBanner({
  organisationId,
  role,
}: {
  organisationId: string;
  role: Role;
}) {
  const alerts = await listOpenAlerts(db(), organisationId);
  if (alerts.length === 0) return null;
  const canAcknowledge = can(role, "settings.manage");
  return (
    <section
      aria-label="Alerts"
      data-testid="alerts-banner"
      className="mb-6 space-y-2 rounded border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
    >
      <h2 className="font-semibold">
        {alerts.length === 1 ? "1 open alert" : `${alerts.length} open alerts`}
      </h2>
      <ul className="space-y-2">
        {alerts.map((alert) => (
          <li
            key={alert.id}
            data-testid="alert-row"
            data-alert-kind={alert.kind}
            className="flex flex-wrap items-center justify-between gap-2"
          >
            <div>
              <span className="mr-2 rounded bg-amber-200 px-1.5 py-0.5 text-xs font-medium uppercase">
                {kindLabel(alert.kind)}
              </span>
              <span>{alert.message}</span>
              <span className="ml-2 text-xs text-amber-700">{formatDateTime(alert.raisedAt)}</span>
            </div>
            <div className="flex items-center gap-2">
              {alert.kind === "daily_message_cap" || alert.kind === "daily_spend_cap" ? (
                <Link href="/settings/billing" className="text-xs underline">
                  Raise the cap
                </Link>
              ) : null}
              {alert.kind === "low_balance" ? (
                <Link href="/billing" className="text-xs underline">
                  Fund the account
                </Link>
              ) : null}
              {canAcknowledge ? <AcknowledgeAlertButton alertId={alert.id} /> : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
