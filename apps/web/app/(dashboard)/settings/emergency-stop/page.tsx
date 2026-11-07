import type { EmergencyStopState } from "@sendex/core";
import { PageHeader } from "@sendex/ui";
import { readEmergencyStop, WorkerApiError, workerApiConfig } from "../../../../lib/worker-api";
import { workerPublicUrl } from "../../../../lib/worker-public-url";
import { RequireOrg } from "../../require-org";
import { EmergencyStopSwitch } from "./emergency-stop-switch";

export const dynamic = "force-dynamic";

async function currentState(
  organisationId: string,
): Promise<{ state: EmergencyStopState | null; unavailable: string | null }> {
  if (!workerPublicUrl() && !workerApiConfig().secret) {
    // Production before the worker exists: say so instead of quoting a missing variable.
    return { state: null, unavailable: "the worker service is not deployed yet" };
  }
  try {
    return { state: await readEmergencyStop(organisationId), unavailable: null };
  } catch (error) {
    if (error instanceof WorkerApiError) return { state: null, unavailable: error.message };
    return {
      state: null,
      unavailable: error instanceof Error && error.name === "TimeoutError" ? "timeout" : "offline",
    };
  }
}

/** Owner-only: the organisation-wide emergency stop switch (D2-09). */
export default function EmergencyStopPage() {
  return (
    <RequireOrg action="emergency.stop">
      {async (ctx) => {
        const { state, unavailable } = await currentState(ctx.organisationId);
        return (
          <section className="max-w-2xl space-y-4">
            <PageHeader
              breadcrumb={[{ label: "Settings", href: "/settings" }, { label: "Emergency stop" }]}
              title="Emergency stop"
            />
            <p className="text-sm text-neutral-600">
              Halts every campaign of the organisation at once: running laps stop after the batch
              they are on, nothing new is dispatched, and scheduled sends wait. Messages already
              handed to a carrier still go out. Clearing the stop lets campaigns that are still
              <span className="font-medium"> sending</span> carry on; laps the stop cancelled are
              not restarted (queue a Finish List lap to send the rest).
            </p>
            <EmergencyStopSwitch state={state} unavailable={unavailable} />
          </section>
        );
      }}
    </RequireOrg>
  );
}
