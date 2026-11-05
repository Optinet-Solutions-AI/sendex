"use client";

import { useId, useState, useTransition } from "react";
import { updateSendSettingsAction } from "../../app/(dashboard)/campaigns/actions";
import { isoToLocalInput, localInputToIso, scheduleNote } from "./schedule";
import type { CampaignView } from "./types";
import { Button, ErrorText, inputClass, Panel, Toggle } from "./ui";

/** Send Now toggle or a start time entered in the campaign timezone. */
export function SchedulePanel({
  campaign,
  onChanged,
}: {
  campaign: CampaignView;
  onChanged: () => void;
}) {
  const id = useId();
  const [sendNow, setSendNow] = useState(campaign.scheduledAt === null);
  const [local, setLocal] = useState(isoToLocalInput(campaign.scheduledAt, campaign.timezone));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function save(nextSendNow: boolean, nextLocal: string) {
    setError(null);
    const scheduledAt = nextSendNow ? null : localInputToIso(nextLocal, campaign.timezone);
    if (!nextSendNow && scheduledAt === null) {
      setError("Pick a start date and time");
      return;
    }
    start(async () => {
      const result = await updateSendSettingsAction({
        campaignId: campaign.id,
        testSize: campaign.testSize,
        contactReuse: campaign.contactReuse,
        sendNow: nextSendNow,
        ...(scheduledAt ? { scheduledAt } : {}),
      });
      if (!result.ok) setError(result.error);
      else onChanged();
    });
  }

  return (
    <Panel title="Schedule" testId="schedule-panel">
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <Toggle
            name="send-now"
            label="Send now"
            checked={sendNow}
            onChange={(next) => {
              setSendNow(next);
              if (next) save(true, local);
            }}
          />
          <span className="text-sm">Send Now</span>
        </div>
        {!sendNow ? (
          <div className="space-y-2">
            <label
              htmlFor={`${id}-start`}
              className="block text-xs font-medium uppercase text-neutral-500"
            >
              Start time
            </label>
            <div className="flex gap-2">
              <input
                id={`${id}-start`}
                type="datetime-local"
                className={`${inputClass} w-auto`}
                value={local}
                onChange={(e) => setLocal(e.target.value)}
              />
              <Button onClick={() => save(false, local)} disabled={pending}>
                Save start time
              </Button>
            </div>
            <p className="text-xs text-neutral-500">
              {scheduleNote(campaign.country, campaign.timezone)}
            </p>
          </div>
        ) : null}
        <ErrorText error={error} />
      </div>
    </Panel>
  );
}
