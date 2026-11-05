"use client";

import { MAX_LOW_BALANCE_EMAILS } from "@sendex/core";
import { Button, Input, Label, Textarea, useToast } from "@sendex/ui";
import { useRouter } from "next/navigation";
import { type FormEvent, useState, useTransition } from "react";
import { updateBillingSettingsAction } from "../../billing/actions";

export interface BillingSettingsFormValues {
  lowBalanceThresholdEur: string;
  /** One address per line. */
  lowBalanceEmails: string;
  dailyMessageCap: string;
  dailySpendCapEur: string;
}

/** The billing settings form; every field blank means "not set". */
export function BillingSettingsForm({
  initial,
  canManage,
}: {
  initial: BillingSettingsFormValues;
  canManage: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [values, setValues] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function set<K extends keyof BillingSettingsFormValues>(key: K, value: string) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await updateBillingSettingsAction({
        lowBalanceThresholdEur: values.lowBalanceThresholdEur,
        lowBalanceEmails: values.lowBalanceEmails.split(/\r?\n/),
        dailyMessageCap: values.dailyMessageCap,
        dailySpendCapEur: values.dailySpendCapEur,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast({ title: "Billing settings saved", variant: "success" });
      router.refresh();
    });
  }

  const disabled = !canManage || pending;
  return (
    <form onSubmit={submit} className="space-y-5 rounded border border-neutral-200 bg-white p-5">
      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold">Low balance alert</legend>
        <div className="space-y-1">
          <Label htmlFor="low-balance-threshold">Alert when the balance drops below (EUR)</Label>
          <Input
            id="low-balance-threshold"
            inputMode="decimal"
            placeholder="Leave blank to disable"
            value={values.lowBalanceThresholdEur}
            onChange={(e) => set("lowBalanceThresholdEur", e.target.value)}
            disabled={disabled}
            className="max-w-xs"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="low-balance-emails">
            Send the alert to (one address per line, up to {MAX_LOW_BALANCE_EMAILS})
          </Label>
          <Textarea
            id="low-balance-emails"
            value={values.lowBalanceEmails}
            onChange={(e) => set("lowBalanceEmails", e.target.value)}
            disabled={disabled}
            placeholder={"owner@example.com\nfinance@example.com"}
          />
        </div>
      </fieldset>
      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold">Daily caps</legend>
        <div className="space-y-1">
          <Label htmlFor="daily-message-cap">Messages per day</Label>
          <Input
            id="daily-message-cap"
            inputMode="numeric"
            placeholder="Leave blank for no cap"
            value={values.dailyMessageCap}
            onChange={(e) => set("dailyMessageCap", e.target.value)}
            disabled={disabled}
            className="max-w-xs"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="daily-spend-cap">Spend per day (EUR)</Label>
          <Input
            id="daily-spend-cap"
            inputMode="decimal"
            placeholder="Leave blank for no cap"
            value={values.dailySpendCapEur}
            onChange={(e) => set("dailySpendCapEur", e.target.value)}
            disabled={disabled}
            className="max-w-xs"
          />
        </div>
      </fieldset>
      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {canManage ? (
        <Button type="submit" disabled={pending} data-testid="save-billing-settings">
          {pending ? "Saving…" : "Save settings"}
        </Button>
      ) : (
        <p className="text-sm text-neutral-600">Only an owner can change these settings.</p>
      )}
    </form>
  );
}
