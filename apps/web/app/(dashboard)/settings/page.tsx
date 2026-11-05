import { UserProfile } from "@clerk/nextjs";
import { can } from "@sendex/core";
import { RequireOrg } from "../require-org";

/**
 * Account settings. Clerk's `UserProfile` includes the security tab: password, two-factor
 * (TOTP / backup codes) and the active device list where a user can sign out other sessions.
 */
export default function SettingsPage() {
  return (
    <RequireOrg action="settings.view">
      {(ctx) => (
        <section>
          <h1 className="text-2xl font-semibold">Settings</h1>
          <p className="mt-2 text-sm text-neutral-600">
            Your role is <span className="font-medium">{ctx.role}</span>.{" "}
            {can(ctx.role, "settings.manage")
              ? "You can manage organisation settings, members and balance."
              : "Organisation settings are read only for your role."}
          </p>
          <div className="mt-6">
            <UserProfile routing="hash" />
          </div>
        </section>
      )}
    </RequireOrg>
  );
}
