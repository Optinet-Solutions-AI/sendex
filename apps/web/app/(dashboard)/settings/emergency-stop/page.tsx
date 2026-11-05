import type { EmergencyStopState } from "@sendex/core";
import Link from "next/link";
import { readEmergencyStop, WorkerApiError } from "../../../../lib/worker-api";
import { RequireOrg } from "../../require-org";
import { EmergencyStopSwitch } from "./emergency-stop-switch";

export const dynamic = "force-dynamic";

async function currentState(
  organisationId: string,
): Promise<{ state: EmergencyStopState | null; unavailable: string | null }> {
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
            <nav aria-label="Breadcrumb" className="text-sm text-neutral-500">
              <Link href="/settings" className="hover:underline">
                Settings
              </Link>{" "}
              / Emergency stop
            </nav>
            <h1 className="text-2xl font-semibold">Emergency stop</h1>
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
