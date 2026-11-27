import {
  alertKindLabel,
  alertSummary,
  balanceTopUp,
  can,
  groupAlerts,
  type Role,
} from "@sendex/core";
import { db, listOpenAlerts, organisationBalance } from "@sendex/db";
import Link from "next/link";
import { formatDateTime } from "../../lib/format";
import { AcknowledgeAlertButton } from "./acknowledge-alert-button";
import { EarlierAlerts } from "./earlier-alerts";

/** A word on what a kind means, shown under its newest alert. */
const KIND_HINTS: Record<string, string> = {
  send_spike:
    "Expected when a big campaign starts. If you did not plan one, check your campaigns and API tokens.",
};

/**
 * Open alerts of the organisation (D3-11) as a banner above every dashboard page: a daily
 * cap reached, a sending spike, a low balance. One row per kind with its newest alert in
 * plain words and the older ones folded away (D5-24). Owners acknowledge a kind, or all;
 * the settings link is where a cap gets raised before the paused campaign is resumed.
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
  const groups = groupAlerts(alerts);
  const canAcknowledge = can(role, "settings.manage");
  // A low balance is topped up at the carrier when the balance is the carrier's (D5-19).
  const topUp = alerts.some((a) => a.kind === "low_balance")
    ? balanceTopUp(
        (await organisationBalance(db(), organisationId)).carriers.map((c) => c.routeName),
      )
    : null;
  return (
    <section
      aria-label="Alerts"
      data-testid="alerts-banner"
      className="mb-6 rounded border border-amber-300 bg-amber-50 text-sm text-amber-900"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-200 px-4 py-2">
        <h2 className="font-semibold">
          {alerts.length === 1 ? "1 open alert" : `${alerts.length} open alerts`}
        </h2>
        {canAcknowledge && groups.length > 1 ? (
          <AcknowledgeAlertButton
            alertIds={alerts.map((a) => a.id)}
            label="Acknowledge all"
            testId="acknowledge-all-alerts"
          />
        ) : null}
      </div>
      <ul className="divide-y divide-amber-200">
        {groups.map((group) => {
          const { latest, earlier, kind } = group;
          const count = group.ids.length;
          const hint = KIND_HINTS[kind];
          return (
            <li
              key={kind}
              data-testid="alert-row"
              data-alert-kind={kind}
              className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 py-3"
            >
              <div className="min-w-0 flex-1 basis-64 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded bg-amber-200 px-1.5 py-0.5 text-xs font-medium uppercase tracking-wide">
                    {alertKindLabel(kind)}
                  </span>
                  {count > 1 ? (
                    <span className="text-xs font-medium text-amber-800">{count} alerts</span>
                  ) : null}
                  <span className="text-xs tabular-nums text-amber-700">
                    {formatDateTime(latest.raisedAt)}
                  </span>
                </div>
                <p>{alertSummary(latest)}</p>
                {hint ? <p className="text-xs text-amber-800">{hint}</p> : null}
                {earlier.length > 0 ? (
                  <EarlierAlerts
                    alerts={earlier.map((a) => ({
                      id: a.id,
                      when: formatDateTime(a.raisedAt),
                      text: alertSummary(a),
                    }))}
                  />
                ) : null}
              </div>
              <div className="flex items-center gap-3">
                {kind === "daily_message_cap" || kind === "daily_spend_cap" ? (
                  <Link href="/settings/billing" className="text-xs underline">
                    Raise the cap
                  </Link>
                ) : null}
                {kind === "low_balance" && topUp ? (
                  <Link href="/billing" className="text-xs underline">
                    {topUp.alertLinkLabel}
                  </Link>
                ) : null}
                {canAcknowledge ? (
                  <AcknowledgeAlertButton
                    alertIds={group.ids}
                    label={count > 1 ? `Acknowledge ${count}` : "Acknowledge"}
                  />
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
