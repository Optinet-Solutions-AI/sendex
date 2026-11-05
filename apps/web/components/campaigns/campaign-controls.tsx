"use client";

import { canTransition } from "@sendex/core";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import {
  cancelScheduleAction,
  controlCampaignAction,
  rescheduleCampaignAction,
} from "../../app/(dashboard)/campaigns/control-actions";
import { formatDateTime } from "./format";
import { isoToLocalInput, localInputToIso, scheduleNote } from "./schedule";
import type { CampaignView } from "./types";
import { Button, ErrorText, inputClass, Modal } from "./ui";

export interface CampaignControlsProps {
  campaign: CampaignView;
  /** `campaign.stop`: may pause and stop. */
  canStop: boolean;
  /** `campaign.send`: may resume and change or cancel the schedule. */
  canSend: boolean;
}

/**
 * Pause / Resume / Stop under the campaign header, with a confirm dialog for Stop, and the
 * schedule editor (change time, cancel schedule) while the campaign is waiting for its start
 * time. Which buttons show follows `canTransition` from `@sendex/core`, so the UI and the
 * server agree on what is allowed. See docs/using/schedule-pause-stop.md.
 */
export function CampaignControls({ campaign, canStop, canSend }: CampaignControlsProps) {
  const router = useRouter();
  const id = useId();
  const [error, setError] = useState<string | null>(null);
  const [confirmStop, setConfirmStop] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [local, setLocal] = useState(isoToLocalInput(campaign.scheduledAt, campaign.timezone));
  const [pending, start] = useTransition();

  const status = campaign.status;
  const showPause = canStop && canTransition(status, "pause");
  const showResume = canSend && canTransition(status, "resume");
  const showStop = canStop && canTransition(status, "stop");
  const showSchedule =
    canSend &&
    status === "scheduled" &&
    campaign.scheduledAt !== null &&
    canTransition(status, "reschedule");
  const remaining = campaign.laps
    .filter((l) => l.status === "queued" || l.status === "sending")
    .reduce((sum, l) => sum + Math.max(0, l.testSize - l.sent - l.failed), 0);

  function control(action: "pause" | "resume" | "stop") {
    setError(null);
    start(async () => {
      const result = await controlCampaignAction({ campaignId: campaign.id, action });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setConfirmStop(false);
      router.refresh();
    });
  }

  function saveSchedule() {
    setError(null);
    const scheduledAt = localInputToIso(local, campaign.timezone);
    if (!scheduledAt) {
      setError("Pick a start date and time");
      return;
    }
    start(async () => {
      const result = await rescheduleCampaignAction({ campaignId: campaign.id, scheduledAt });
      if (!result.ok) setError(result.error);
      else router.refresh();
    });
  }

  function cancelSchedule() {
    setError(null);
    start(async () => {
      const result = await cancelScheduleAction({ campaignId: campaign.id });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setConfirmCancel(false);
      router.refresh();
    });
  }

  if (!showPause && !showResume && !showStop && !showSchedule && !error) return null;

  return (
    <section
      data-testid="campaign-controls"
      className="space-y-3 rounded border border-neutral-200 bg-white px-4 py-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        {status === "paused" ? (
          <span className="text-sm text-orange-800">
            Paused. Nothing new is submitted until you resume.
          </span>
        ) : null}
        {showPause ? (
          <Button onClick={() => control("pause")} disabled={pending} data-testid="campaign-pause">
            Pause
          </Button>
        ) : null}
        {showResume ? (
          <Button
            variant="primary"
            onClick={() => control("resume")}
            disabled={pending}
            data-testid="campaign-resume"
          >
            Resume
          </Button>
        ) : null}
        {showStop ? (
          <Button
            variant="danger"
            onClick={() => setConfirmStop(true)}
            disabled={pending}
            data-testid="campaign-stop"
          >
            Stop
          </Button>
        ) : null}
      </div>

      {showSchedule && campaign.scheduledAt ? (
        <div className="space-y-2 border-t border-neutral-100 pt-3" data-testid="schedule-editor">
          <p className="text-sm">
            Scheduled for{" "}
            <span className="font-medium" data-testid="scheduled-for">
              {formatDateTime(campaign.scheduledAt, campaign.timezone)}
            </span>{" "}
            <span className="text-neutral-500">({campaign.timezone})</span>
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label
                htmlFor={`${id}-time`}
                className="block text-xs font-medium uppercase text-neutral-500"
              >
                New start time
              </label>
              <input
                id={`${id}-time`}
                type="datetime-local"
                className={`${inputClass} w-auto`}
                value={local}
                onChange={(e) => setLocal(e.target.value)}
                data-testid="schedule-time"
              />
            </div>
            <Button onClick={saveSchedule} disabled={pending} data-testid="save-schedule">
              Change time
            </Button>
            <Button
              variant="danger"
              onClick={() => setConfirmCancel(true)}
              disabled={pending}
              data-testid="cancel-schedule"
            >
              Cancel schedule
            </Button>
          </div>
          <p className="text-xs text-neutral-500">
            {scheduleNote(campaign.country, campaign.timezone)}
          </p>
        </div>
      ) : null}

      <ErrorText error={error} />

      <Modal open={confirmStop} title="Stop campaign" onClose={() => setConfirmStop(false)}>
        <p className="text-sm text-neutral-700">
          Stop <span className="font-medium">{campaign.name}</span>? The remaining{" "}
          <span className="font-medium">{remaining.toLocaleString("en-GB")}</span> contacts will not
          be sent, queued laps are cancelled and the campaign cannot be resumed. Messages already
          handed to the carrier still go out.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button onClick={() => setConfirmStop(false)} disabled={pending}>
            Keep sending
          </Button>
          <Button
            variant="danger"
            onClick={() => control("stop")}
            disabled={pending}
            data-testid="confirm-stop"
          >
            {pending ? "Stopping…" : "Stop campaign"}
          </Button>
        </div>
      </Modal>

      <Modal open={confirmCancel} title="Cancel schedule" onClose={() => setConfirmCancel(false)}>
        <p className="text-sm text-neutral-700">
          Cancel the scheduled send of <span className="font-medium">{campaign.name}</span>? Its
          queued laps are dropped and the campaign goes back to draft; you can send it again later.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button onClick={() => setConfirmCancel(false)} disabled={pending}>
            Keep schedule
          </Button>
          <Button
            variant="danger"
            onClick={cancelSchedule}
            disabled={pending}
            data-testid="confirm-cancel-schedule"
          >
            {pending ? "Cancelling…" : "Cancel schedule"}
          </Button>
        </div>
      </Modal>
    </section>
  );
}
