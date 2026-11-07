"use client";

import { Button, ConfirmDialog, Tooltip, useToast } from "@sendex/ui";
import { ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  type HlrVerifyEstimate,
  hlrVerifyAction,
  hlrVerifyEstimateAction,
} from "../../app/(dashboard)/enrichment/actions";
import { eur, int } from "../dashboard/format";

/** 🛡 HLR Verify on the list's Lookup tab: shows the count and cost, then queues the request. */
export function HlrVerifyButton({ listId, canVerify }: { listId: string; canVerify: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const [estimate, setEstimate] = useState<HlrVerifyEstimate | null>(null);
  const [open, setOpen] = useState(false);
  const [, start] = useTransition();
  const ask = () =>
    start(async () => {
      const result = await hlrVerifyEstimateAction({ listId });
      if (!result.ok) {
        toast({ title: result.error, variant: "error" });
        return;
      }
      setEstimate(result.data);
      setOpen(true);
    });
  const cost =
    estimate?.costMicro === null || estimate?.costMicro === undefined
      ? null
      : Number(estimate.costMicro);
  return (
    <>
      <Tooltip content="Run a network lookup on the numbers that have none yet">
        <Button
          variant="outline"
          size="sm"
          onClick={ask}
          disabled={!canVerify}
          data-testid="hlr-verify"
        >
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" /> HLR Verify
        </Button>
      </Tooltip>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Verify this list's numbers?"
        description={
          estimate
            ? estimate.count === 0
              ? "Every number of this list is verified already."
              : cost === null
                ? `${int(estimate.count)} numbers are unverified, but no lookup route covers this country yet.`
                : `${int(estimate.count)} unverified ${estimate.count === 1 ? "number" : "numbers"} × €${(Number(estimate.priceMicro) / 1_000_000).toFixed(4)} = ${eur(cost)}, charged to your balance as the lookups run.`
            : ""
        }
        confirmLabel="Verify"
        onConfirm={async () => {
          const result = await hlrVerifyAction({ listId });
          if (!result.ok) throw new Error(result.error);
          toast({
            title: "Verification queued",
            description: `${int(result.data.count)} numbers go to the lookup provider from the worker.`,
            variant: "success",
          });
          router.refresh();
        }}
      />
    </>
  );
}
