"use client";

import type { ContactReuse } from "@sendex/core";
import { Toggle } from "@sendex/ui";
import { Info } from "lucide-react";
import Link from "next/link";
import { useId, useState, useTransition } from "react";
import { updateSendSettingsAction } from "../../app/(dashboard)/campaigns/actions";
import type { CampaignView } from "./types";
import { ErrorText, inputClass, Toggle as LegacyToggle } from "./ui";

/** The two contact reuse cards with the spec's wording. */
export const CONTACT_REUSE_OPTIONS: ReadonlyArray<{
  value: ContactReuse;
  label: string;
  help: string;
}> = [
  {
    value: "account_wide",
    label: "Account-wide",
    help: "A contact is messaged once across all your campaigns. Use Flush on a list to make its contacts available again.",
  },
  {
    value: "per_campaign",
    label: "Per campaign",
    help: "This campaign can message every contact in its lists, even if another campaign already did — no flushing needed. Contacts are still messaged only once within this campaign; to message them again, create a new campaign.",
  },
];

/** The three AutoSender knobs, each a column on the campaign. */
const AUTOSENDER_KNOBS: ReadonlyArray<{
  key: "measure" | "scale" | "floor";
  label: string;
  hint: string;
  range: { min: number; max: number; label: string };
  field: "autosenderMeasureMinutes" | "autosenderScaleFactor" | "autosenderCtrFloorPercent";
}> = [
  {
    key: "measure",
    label: "Measure (minutes)",
    hint: "Wait this long after the test round starts before judging it.",
    range: { min: 0, max: 10_080, label: "Measure" },
    field: "autosenderMeasureMinutes",
  },
  {
    key: "scale",
    label: "Scale factor (×)",
    hint: "Each scale-out lap sends this many times the test size.",
    range: { min: 1, max: 100, label: "Scale factor" },
    field: "autosenderScaleFactor",
  },
  {
    key: "floor",
    label: "CTR floor (%)",
    hint: "Stop once a scale-out lap's CTR falls below this share of the test CTR.",
    range: { min: 0, max: 100, label: "CTR floor" },
    field: "autosenderCtrFloorPercent",
  },
];

/**
 * Advanced Settings of the spec: the segments note, Send All, Test Size, the contact reuse
 * cards (locked after the first send) and Run AutoSender with its three knobs.
 */
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
  const locked = campaign.laps.length > 0;

  const [knobs, setKnobs] = useState({
    measure: String(campaign.autosenderMeasureMinutes),
    scale: String(campaign.autosenderScaleFactor),
    floor: String(campaign.autosenderCtrFloorPercent),
  });

  function save(next: {
    testSize?: number;
    contactReuse?: ContactReuse;
    autosender?: boolean;
    autosenderMeasureMinutes?: number;
    autosenderScaleFactor?: number;
    autosenderCtrFloorPercent?: number;
  }) {
    setError(null);
    start(async () => {
      const result = await updateSendSettingsAction({
        campaignId: campaign.id,
        testSize: next.testSize ?? campaign.testSize,
        contactReuse: next.contactReuse ?? campaign.contactReuse,
        sendNow: campaign.scheduledAt === null,
        ...(campaign.scheduledAt ? { scheduledAt: campaign.scheduledAt } : {}),
        ...(next.autosender === undefined ? {} : { autosender: next.autosender }),
        ...(next.autosenderMeasureMinutes === undefined
          ? {}
          : { autosenderMeasureMinutes: next.autosenderMeasureMinutes }),
        ...(next.autosenderScaleFactor === undefined
          ? {}
          : { autosenderScaleFactor: next.autosenderScaleFactor }),
        ...(next.autosenderCtrFloorPercent === undefined
          ? {}
          : { autosenderCtrFloorPercent: next.autosenderCtrFloorPercent }),
      });
      if (!result.ok) setError(result.error);
      else onChanged();
    });
  }

  /** One AutoSender knob: validated on blur or Enter, saved only when it changed. */
  function commitKnob(
    key: "measure" | "scale" | "floor",
    current: number,
    range: { min: number; max: number; label: string },
    field: "autosenderMeasureMinutes" | "autosenderScaleFactor" | "autosenderCtrFloorPercent",
  ) {
    const value = Number.parseInt(knobs[key], 10);
    if (!Number.isInteger(value) || value < range.min || value > range.max) {
      setError(`${range.label} must be a whole number from ${range.min} to ${range.max}`);
      return;
    }
    if (value !== current) save({ [field]: value });
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
    <div
      className="space-y-4 rounded-md border border-rule bg-page p-4"
      data-testid="advanced-settings"
    >
      <p className="flex items-start gap-2 text-xs text-muted">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>
          To segment by carriers, age and other properties please use{" "}
          <Link href="/lists" className="underline">
            Segments
          </Link>
          .
        </span>
      </p>
      <div className="flex items-center gap-3">
        <LegacyToggle
          name="send-all"
          label="Send all"
          checked={sendAll}
          onChange={onSendAllChange}
        />
        <span className="text-sm">
          Send All
          <span className="block text-xs text-muted">
            Send to the whole audience instead of a test batch.
          </span>
        </span>
      </div>
      <div>
        <label
          htmlFor={`${id}-test-size`}
          className="block text-xs font-medium uppercase text-muted"
        >
          Test Size *
        </label>
        <input
          id={`${id}-test-size`}
          type="number"
          min={1}
          max={100_000}
          className={`${inputClass} mt-1 w-40`}
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
      </div>
      <fieldset className="space-y-2">
        <legend className="text-xs font-medium uppercase text-muted">Contact reuse</legend>
        <div className="grid gap-2 md:grid-cols-2">
          {CONTACT_REUSE_OPTIONS.map((option) => {
            const checked = campaign.contactReuse === option.value;
            return (
              <label
                key={option.value}
                className={`flex cursor-pointer items-start gap-2 rounded-md border p-3 text-sm ${
                  checked ? "border-navy bg-navy-soft" : "border-rule bg-surface"
                } ${locked ? "cursor-not-allowed opacity-70" : ""}`}
              >
                <input
                  type="radio"
                  name={`${id}-reuse`}
                  value={option.value}
                  checked={checked}
                  onChange={() => save({ contactReuse: option.value })}
                  disabled={pending || locked}
                  className="mt-1"
                />
                <span>
                  <span className="font-medium text-ink">{option.label}</span>
                  {option.value === "account_wide" ? (
                    <span className="ml-1 text-xs text-muted">(default)</span>
                  ) : null}
                  <span className="mt-0.5 block text-xs text-muted">{option.help}</span>
                </span>
              </label>
            );
          })}
        </div>
        <p className="text-xs text-muted">
          Your choice is remembered for the campaigns you create next. It can't be changed after the
          first send.
        </p>
      </fieldset>
      <div className="flex items-start gap-3">
        <Toggle
          label="Run AutoSender"
          labelHidden
          checked={campaign.autosender}
          onCheckedChange={(next) => save({ autosender: next })}
          disabled={pending}
        />
        <span className="text-sm">
          Run AutoSender
          <span className="block text-xs text-muted">
            Sends a small test batch first, measures clicks &amp; signups, then automatically scales
            out the best-performing message and route. Recommended for large sends.
          </span>
        </span>
      </div>
      {campaign.autosender ? (
        <div
          className="space-y-2 rounded-md border border-rule bg-surface p-3"
          data-testid="autosender-settings"
        >
          {campaign.autosenderStopReason ? (
            <p className="text-xs text-amber" data-testid="autosender-stopped">
              AutoSender stopped: {campaign.autosenderStopReason}. Switch it off and on to run it
              again.
            </p>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-3">
            {AUTOSENDER_KNOBS.map((k) => (
              <div key={k.key}>
                <label
                  htmlFor={`${id}-${k.key}`}
                  className="block text-xs font-medium uppercase text-muted"
                >
                  {k.label}
                </label>
                <input
                  id={`${id}-${k.key}`}
                  type="number"
                  min={k.range.min}
                  max={k.range.max}
                  className={`${inputClass} mt-1`}
                  value={knobs[k.key]}
                  onChange={(e) => setKnobs({ ...knobs, [k.key]: e.target.value })}
                  onBlur={() => commitKnob(k.key, campaign[k.field], k.range, k.field)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      commitKnob(k.key, campaign[k.field], k.range, k.field);
                    }
                  }}
                  disabled={pending}
                  data-testid={`autosender-${k.key}`}
                />
                <p className="mt-1 text-xs text-muted">{k.hint}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      <ErrorText error={error} />
    </div>
  );
}
