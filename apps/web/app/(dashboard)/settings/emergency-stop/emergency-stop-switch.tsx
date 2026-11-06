"use client";

import type { EmergencyStopState } from "@sendex/core";
import { Button, Input, Label, useToast } from "@sendex/ui";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { clearEmergencyStopAction, raiseEmergencyStopAction } from "./actions";

const when = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
});

function formatStoppedAt(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : `${when.format(date)} UTC`;
}

/**
 * The owner-only switch: shows whether the organisation is stopped (who, when, why), raises
 * the stop with a reason after a confirmation, or clears it.
 */
export function EmergencyStopSwitch({
  state,
  unavailable,
}: {
  state: EmergencyStopState | null;
  /** Why the state could not be read, when the worker did not answer. */
  unavailable: string | null;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function raise() {
    setError(null);
    if (
      !window.confirm(
        "Activate the emergency stop? Every running lap of this organisation stops after its current batch and nothing new is dispatched until you clear it.",
      )
    ) {
      return;
    }
    start(async () => {
      const result = await raiseEmergencyStopAction({ reason });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast({ title: "Emergency stop active", variant: "error" });
      setReason("");
      router.refresh();
    });
  }

  function clear() {
    setError(null);
    start(async () => {
      const result = await clearEmergencyStopAction();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast({ title: "Emergency stop cleared", variant: "success" });
      router.refresh();
    });
  }

  const stopped = state?.stopped === true;
  return (
    <div
      className={`space-y-4 rounded border p-5 ${
        stopped ? "border-red-300 bg-red-50" : "border-neutral-200 bg-white"
      }`}
      data-testid="emergency-stop-panel"
      data-stopped={stopped ? "true" : "false"}
    >
      {unavailable ? (
        <p role="alert" className="text-sm text-amber-800" data-testid="emergency-stop-unavailable">
          The worker could not be reached ({unavailable}), so the current state is unknown.
        </p>
      ) : stopped && state?.stop ? (
        <div className="text-sm text-red-900">
          <p className="font-semibold">Emergency stop is active.</p>
          <p className="mt-1">
            Since {formatStoppedAt(state.stop.stoppedAt)}, reason:{" "}
            <span className="font-medium" data-testid="emergency-stop-reason">
              {state.stop.reason}
            </span>
            . Laps cancel after their current batch and the dispatcher starts nothing new.
          </p>
        </div>
      ) : (
        <p className="text-sm text-neutral-700">
          Sending is running normally. Use the emergency stop when a text is wrong, a link is broken
          or a route misbehaves and everything must halt first.
        </p>
      )}

      {stopped ? (
        <Button type="button" onClick={clear} disabled={pending} data-testid="clear-emergency-stop">
          {pending ? "Clearing…" : "Clear emergency stop"}
        </Button>
      ) : (
        <div className="space-y-2">
          <div className="space-y-1">
            <Label htmlFor="emergency-stop-reason">Reason (kept in the audit log)</Label>
            <Input
              id="emergency-stop-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. broken link in the live text"
              disabled={pending}
              className="max-w-md"
            />
          </div>
          <Button
            type="button"
            variant="destructive"
            onClick={raise}
            disabled={pending || reason.trim() === ""}
            data-testid="raise-emergency-stop"
          >
            {pending ? "Stopping…" : "Activate emergency stop"}
          </Button>
        </div>
      )}
      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
