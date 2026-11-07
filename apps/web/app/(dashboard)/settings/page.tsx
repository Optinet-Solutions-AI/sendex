import { UserProfile } from "@clerk/nextjs";
import { can } from "@sendex/core";
import { PageHeader } from "@sendex/ui";
import Link from "next/link";
import { authMode } from "../../../lib/env";
import { RequireOrg } from "../require-org";

/**
 * Account settings. Clerk's `UserProfile` includes the security tab: password, two-factor
 * (TOTP / backup codes) and the active device list where a user can sign out other sessions.
 * Under the development auth stub there is no Clerk user, so a note is shown instead.
 */
export default function SettingsPage() {
  const mode = authMode();
  return (
    <RequireOrg action="settings.view">
      {(ctx) => (
        <section>
          <PageHeader
            breadcrumb={[{ label: "Settings" }, { label: "General" }]}
            title="Settings"
            subtitle={
              <>
                Your role is <span className="font-medium">{ctx.role}</span>.{" "}
                {can(ctx.role, "settings.manage")
                  ? "You can manage organisation settings, members and balance."
                  : "Organisation settings are read only for your role."}
              </>
            }
          />
          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              href="/settings/billing"
              className="inline-flex h-9 items-center rounded-md border border-neutral-300 bg-white px-4 text-sm font-medium hover:bg-neutral-100"
            >
              Billing: low balance alert and daily caps
            </Link>
            {can(ctx.role, "emergency.stop") ? (
              <Link
                href="/settings/emergency-stop"
                data-testid="emergency-stop-link"
                className="ml-2 inline-flex h-9 items-center rounded-md border border-red-300 bg-white px-4 text-sm font-medium text-red-700 hover:bg-red-50"
              >
                Emergency stop
              </Link>
            ) : null}
            {can(ctx.role, "settings.manage") ? (
              <Link
                href="/settings/api-tokens"
                className="inline-flex h-9 items-center rounded-md border border-neutral-300 bg-white px-4 text-sm font-medium hover:bg-neutral-100"
              >
                API tokens
              </Link>
            ) : null}
          </div>
          <div className="mt-6">
            {mode === "dev" ? (
              <p className="rounded border border-neutral-200 bg-white p-4 text-sm text-neutral-600">
                Account security (password, two-factor, devices) is managed by Clerk and is not
                available with the development login.
              </p>
            ) : (
              <UserProfile routing="hash" />
            )}
          </div>
        </section>
      )}
    </RequireOrg>
  );
}
