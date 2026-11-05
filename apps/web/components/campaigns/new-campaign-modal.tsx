"use client";

import { countryOptions, timezoneForCountry, timezoneOptions } from "@sendex/core";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { createCampaignAction } from "../../app/(dashboard)/campaigns/actions";
import { Button, ErrorText, Field, inputClass, Modal } from "./ui";

const DEFAULT_COUNTRY = "ES";

/** "New Campaign": name, country (flags) and the timezone derived from it, still editable. */
export function NewCampaignModal() {
  const router = useRouter();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [country, setCountry] = useState(DEFAULT_COUNTRY);
  const [timezone, setTimezone] = useState(timezoneForCountry(DEFAULT_COUNTRY));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function pickCountry(next: string) {
    setCountry(next);
    setTimezone(timezoneForCountry(next));
  }

  function submit() {
    setError(null);
    start(async () => {
      const result = await createCampaignAction({ name, country, timezone });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      router.push(`/campaigns/${result.data.id}`);
    });
  }

  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)} data-testid="new-campaign">
        New Campaign
      </Button>
      <Modal open={open} title="New Campaign" onClose={() => setOpen(false)}>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <Field label="Name" htmlFor={`${id}-name`}>
            <input
              id={`${id}-name`}
              name="name"
              className={inputClass}
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </Field>
          <Field label="Country" htmlFor={`${id}-country`}>
            <select
              id={`${id}-country`}
              name="country"
              className={inputClass}
              value={country}
              onChange={(e) => pickCountry(e.target.value)}
            >
              {countryOptions.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.flag} {c.name} ({c.code})
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Timezone"
            htmlFor={`${id}-timezone`}
            hint="Derived from the country; change it if the campaign is scheduled elsewhere."
          >
            <select
              id={`${id}-timezone`}
              name="timezone"
              className={inputClass}
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
            >
              {timezoneOptions.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </Field>
          <ErrorText error={error} />
          <div className="flex justify-end gap-2">
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={pending || name.trim() === ""}>
              {pending ? "Creating…" : "Create campaign"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
