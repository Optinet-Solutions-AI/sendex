import Link from "next/link";
import { readEmergencyStop, workerApiConfig } from "../../lib/worker-api";

/**
 * Red bar across the top of every dashboard page while the organisation's emergency stop is
 * active. Reads the flag through the worker with a short timeout; when the worker cannot be
 * reached (or no secret is configured) the bar is simply not shown, so the dashboard never
 * waits on it.
 */
export async function EmergencyStopBanner({ organisationId }: { organisationId: string }) {
  const config = workerApiConfig();
  if (!config.secret) return null;
  try {
    const state = await readEmergencyStop(organisationId, { ...config, timeoutMs: 1500 });
    if (!state.stopped) return null;
    return (
      <div
        role="alert"
        data-testid="emergency-stop-banner"
        className="flex flex-wrap items-center justify-between gap-2 border-b border-red-300 bg-red-600 px-6 py-2 text-sm text-white"
      >
        <span>
          <span className="font-semibold">Emergency stop active.</span> Nothing is being sent for
          this organisation ({state.stop.reason}).
        </span>
        <Link href="/settings/emergency-stop" className="font-medium underline">
          Review or clear
        </Link>
      </div>
    );
  } catch {
    return null;
  }
}
