import { can, formatSendingHoursText } from "@sendex/core";
import { db, getSendingHours } from "@sendex/db";
import { PageHeader } from "@sendex/ui";
import { AuthError, requireAction } from "../../../../lib/auth";
import { AuthErrorView } from "../../require-org";
import { SendingHoursForm } from "./sending-hours-form";

export const dynamic = "force-dynamic";

/**
 * Suggested sending hours (D4-14): a default window and per-country windows. Readable by
 * every role, editable with `settings.manage`. A campaign whose send time falls outside its
 * country's hours shows a notice; nothing is ever blocked.
 */
export default async function SendingHoursSettingsPage() {
  let ctx: Awaited<ReturnType<typeof requireAction>>;
  try {
    ctx = await requireAction("settings.view");
  } catch (error) {
    if (error instanceof AuthError) return <AuthErrorView error={error} />;
    throw error;
  }
  const hours = await getSendingHours(db(), ctx.organisationId);
  return (
    <section className="max-w-2xl">
      <PageHeader
        breadcrumb={[{ label: "Settings", href: "/settings" }, { label: "Sending hours" }]}
        title="Suggested sending hours"
      />
      <p className="text-sm text-muted">
        The hours you prefer to send in, per country. When a campaign is sent or scheduled outside
        them, its page shows a yellow notice with the local time. It is only a suggestion: the
        campaign still sends. With nothing entered here, no notice is shown.
      </p>
      <div className="mt-6">
        <SendingHoursForm
          canManage={can(ctx.role, "settings.manage")}
          initial={{
            defaultFrom: hours.default?.from ?? "",
            defaultTo: hours.default?.to ?? "",
            countriesText: formatSendingHoursText(hours.countries),
          }}
        />
      </div>
    </section>
  );
}
