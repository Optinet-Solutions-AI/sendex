"use client";

import { Button, Input, Label, Textarea, useToast } from "@sendex/ui";
import { useRouter } from "next/navigation";
import { type FormEvent, useState, useTransition } from "react";
import { updateSendingHoursAction } from "./actions";

export interface SendingHoursFormValues {
  defaultFrom: string;
  defaultTo: string;
  /** One "ES 10:00-21:00" per line. */
  countriesText: string;
}

/** The suggested sending hours form; everything blank means no notice anywhere. */
export function SendingHoursForm({
  initial,
  canManage,
}: {
  initial: SendingHoursFormValues;
  canManage: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [values, setValues] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function set<K extends keyof SendingHoursFormValues>(key: K, value: string) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await updateSendingHoursAction(values);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast({ title: "Sending hours saved", variant: "success" });
      router.refresh();
    });
  }

  const disabled = !canManage || pending;
  return (
    <form
      onSubmit={submit}
      className="space-y-5 rounded border border-neutral-200 bg-white p-5"
      data-testid="sending-hours-form"
    >
      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold">Default hours</legend>
        <p className="text-xs text-neutral-500">
          For every country without its own line below. Local time of the campaign's country. Leave
          both empty for no default.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="sending-hours-from">From</Label>
            <Input
              id="sending-hours-from"
              type="time"
              value={values.defaultFrom}
              onChange={(e) => set("defaultFrom", e.target.value)}
              disabled={disabled}
              className="w-32"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="sending-hours-to">To</Label>
            <Input
              id="sending-hours-to"
              type="time"
              value={values.defaultTo}
              onChange={(e) => set("defaultTo", e.target.value)}
              disabled={disabled}
              className="w-32"
            />
          </div>
        </div>
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">Per country</legend>
        <Label htmlFor="sending-hours-countries">
          One country per line: the 2-letter code, then the hours
        </Label>
        <Textarea
          id="sending-hours-countries"
          value={values.countriesText}
          onChange={(e) => set("countriesText", e.target.value)}
          disabled={disabled}
          placeholder={"ES 10:00-21:00\nGB 09:00-20:00"}
          className="min-h-32 font-mono text-sm"
        />
      </fieldset>
      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {canManage ? (
        <Button type="submit" disabled={pending} data-testid="save-sending-hours">
          {pending ? "Saving…" : "Save sending hours"}
        </Button>
      ) : (
        <p className="text-sm text-neutral-600">Only an owner can change these.</p>
      )}
    </form>
  );
}
