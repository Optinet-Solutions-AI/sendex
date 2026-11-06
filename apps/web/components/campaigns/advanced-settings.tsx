"use client";

import type { ContactReuse } from "@sendex/core";
import { useId, useState, useTransition } from "react";
import { updateSendSettingsAction } from "../../app/(dashboard)/campaigns/actions";
import type { CampaignView } from "./types";
import { ErrorText, Field, inputClass, Panel, Toggle } from "./ui";

/** SMS Edge wording for the two contact reuse modes. */
export const CONTACT_REUSE_OPTIONS: ReadonlyArray<{
  value: ContactReuse;
  label: string;
  help: string;
}> = [
  {
    value: "account_wide",
    label: "Do not send to contacts already sent to by any campaign in this account",
    help: "A number messaged by any campaign of the organisation is skipped.",
  },
  {
    value: "per_campaign",
    label: "Do not send to contacts already sent to by this campaign only",
    help: "Only numbers this campaign already messaged are skipped.",
  },
];

/** Test size, contact reuse and the "send all" toggle. */
export function AdvancedSettings({
  campaign,
  sendAll,
  onSendAllChange,
  onChanged,
}: {
  campaign: CampaignView;
  sendAll: boolean;
  onSendAllChange: (next: boolean) => void;
  onChanged: () => void;
}) {
  const id = useId();
  const [testSize, setTestSize] = useState(String(campaign.testSize));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function save(next: { testSize?: number; contactReuse?: ContactReuse }) {
    setError(null);
    start(async () => {
      const result = await updateSendSettingsAction({
        campaignId: campaign.id,
        testSize: next.testSize ?? campaign.testSize,
        contactReuse: next.contactReuse ?? campaign.contactReuse,
        sendNow: campaign.scheduledAt === null,
        ...(campaign.scheduledAt ? { scheduledAt: campaign.scheduledAt } : {}),
      });
      if (!result.ok) setError(result.error);
      else onChanged();
    });
  }

  function commitTestSize() {
    const value = Number.parseInt(testSize, 10);
    if (!Number.isInteger(value) || value < 1 || value > 100_000) {
      setError("Test size must be a whole number from 1 to 100,000");
      return;
    }
    if (value !== campaign.testSize) save({ testSize: value });
  }

  return (
    <Panel title="Advanced Settings" testId="advanced-settings">
      <div className="space-y-4">
        <Field
          label="Test size"
          htmlFor={`${id}-test-size`}
          hint="Numbers sent per list and route in a test lap before the routes are ranked."
        >
          <input
            id={`${id}-test-size`}
            type="number"
            min={1}
            max={100_000}
            className={`${inputClass} w-40`}
            value={testSize}
            onChange={(e) => setTestSize(e.target.value)}
            onBlur={commitTestSize}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitTestSize();
              }
            }}
            disabled={pending || sendAll}
            data-testid="test-size"
          />
        </Field>
        <fieldset className="space-y-2">
          <legend className="text-xs font-medium uppercase text-neutral-500">Contact reuse</legend>
          {CONTACT_REUSE_OPTIONS.map((option) => (
            <label key={option.value} className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name={`${id}-reuse`}
                value={option.value}
                checked={campaign.contactReuse === option.value}
                onChange={() => save({ contactReuse: option.value })}
                disabled={pending}
                className="mt-1"
              />
              <span>
                {option.label}
                <span className="block text-xs text-neutral-500">{option.help}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <div className="flex items-center gap-3">
          <Toggle name="send-all" label="Send all" checked={sendAll} onChange={onSendAllChange} />
          <span className="text-sm">
            Send all
            <span className="block text-xs text-neutral-500">
              Send every contact left on the lists, split evenly across the routes, instead of a
              test slice.
            </span>
          </span>
        </div>
        <ErrorText error={error} />
      </div>
    </Panel>
  );
}
