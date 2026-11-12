"use client";

import { DEPOSIT_METHODS, type DepositMethod, formatEur } from "@sendex/core";
import { Button, Input, Label, Textarea, useToast } from "@sendex/ui";
import { useRouter } from "next/navigation";
import { type FormEvent, useState, useTransition } from "react";
import { useReauthAction } from "../../../lib/use-reauth-action";
import { recordDepositAction } from "./actions";

const METHOD_LABELS: Record<DepositMethod, string> = {
  wire: "Bank wire",
  crypto: "Crypto",
  manual: "Manual adjustment",
};

/**
 * "Fund your account": the manual deposit form (owners only) next to the card and PayPal
 * buttons that arrive in stage two. Submits through `recordDepositAction`, which also
 * requires a recent sign-in: when it is stale, Clerk asks for the password in a dialog and
 * the deposit is then recorded (D4-15).
 */
export function DepositForm({ canDeposit }: { canDeposit: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<DepositMethod>("wire");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const recordDeposit = useReauthAction(recordDepositAction);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await recordDeposit({ amountEur: amount, method, reference, note });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast({
        title: "Deposit recorded",
        description: `${formatEur(BigInt(result.data.amountMicro))} added. Balance is now ${formatEur(BigInt(result.data.balanceMicro))}.`,
        variant: "success",
      });
      setAmount("");
      setReference("");
      setNote("");
      router.refresh();
    });
  }

  return (
    <section
      aria-labelledby="fund-heading"
      data-testid="fund-panel"
      className="rounded border border-neutral-200 bg-white"
    >
      <header className="border-b border-neutral-200 px-4 py-2">
        <h2 id="fund-heading" className="text-sm font-semibold">
          Fund your account
        </h2>
      </header>
      <div className="space-y-4 p-4">
        {/* The panel is 20rem, so each button gets about 140px: the method on one line and
            "Stage two" under it, rather than one line that runs past the button. */}
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            disabled
            title="Card payments arrive in stage two"
            className="h-auto flex-col gap-0 whitespace-normal py-1.5"
          >
            <span>Pay by card</span>
            <span className="text-xs font-normal text-neutral-500">Stage two</span>
          </Button>
          <Button
            variant="outline"
            disabled
            title="PayPal arrives in stage two"
            className="h-auto flex-col gap-0 whitespace-normal py-1.5"
          >
            <span>PayPal</span>
            <span className="text-xs font-normal text-neutral-500">Stage two</span>
          </Button>
        </div>
        {canDeposit ? (
          <form onSubmit={submit} className="space-y-3">
            <p className="text-xs text-neutral-500">
              Record a wire or crypto payment you have received, or a manual adjustment. The
              reference must be unique; the same reference is never credited twice.
            </p>
            <div className="space-y-1">
              <Label htmlFor="deposit-amount">Amount (EUR)</Label>
              <Input
                id="deposit-amount"
                name="amount"
                inputMode="decimal"
                placeholder="25.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="deposit-method">Method</Label>
              <select
                id="deposit-method"
                name="method"
                value={method}
                onChange={(e) => setMethod(e.target.value as DepositMethod)}
                className="h-9 w-full rounded-md border border-neutral-300 bg-white px-3 text-sm"
              >
                {DEPOSIT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {METHOD_LABELS[m]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="deposit-reference">Reference</Label>
              <Input
                id="deposit-reference"
                name="reference"
                placeholder="Bank or transaction reference"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                maxLength={100}
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="deposit-note">Note</Label>
              <Textarea
                id="deposit-note"
                name="note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={500}
                className="min-h-16"
              />
            </div>
            {error ? (
              <p role="alert" className="text-sm text-red-700">
                {error}
              </p>
            ) : null}
            <Button type="submit" disabled={pending} data-testid="record-deposit">
              {pending ? "Recording…" : "Record deposit"}
            </Button>
          </form>
        ) : (
          <p className="text-sm text-neutral-600">
            Only an owner can record deposits. Ask an owner of your organisation to top up.
          </p>
        )}
      </div>
    </section>
  );
}
