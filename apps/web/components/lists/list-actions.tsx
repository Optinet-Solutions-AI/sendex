"use client";

import { Button, ConfirmDialog, useToast } from "@sendex/ui";
import { Plus, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createCampaignFromListAction, flushListAction } from "../../app/(dashboard)/lists/actions";
import { formatNumber } from "../../lib/format";

/** Refresh, Flush and "+ New Campaign" (a draft in the list's country with the list attached). */
export function ListActions({
  listId,
  listName,
  canFlush,
  canCreateCampaign,
}: {
  listId: string;
  listName: string;
  canFlush: boolean;
  canCreateCampaign: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [flushOpen, setFlushOpen] = useState(false);
  const [pending, start] = useTransition();

  function newCampaign() {
    start(async () => {
      const result = await createCampaignFromListAction(listId);
      if (!result.ok) {
        toast({ title: result.error, variant: "error" });
        return;
      }
      toast({ title: "Campaign created", variant: "success" });
      router.push(`/campaigns/${result.data.campaignId}`);
    });
  }

  return (
    <>
      <Button variant="outline" onClick={() => router.refresh()} aria-label="Refresh">
        <RefreshCw className="h-4 w-4" aria-hidden="true" /> Refresh
      </Button>
      {canFlush ? (
        <Button variant="outline" onClick={() => setFlushOpen(true)}>
          Flush
        </Button>
      ) : null}
      {canCreateCampaign ? (
        <Button onClick={newCampaign} disabled={pending} data-testid="new-campaign-from-list">
          <Plus className="h-4 w-4" aria-hidden="true" /> New Campaign
        </Button>
      ) : null}
      <ConfirmDialog
        open={flushOpen}
        onOpenChange={setFlushOpen}
        title={`Flush ${listName}?`}
        description="Every number in this list becomes available to send again. Bad numbers stay marked bad."
        confirmLabel="Flush list"
        destructive
        onConfirm={async () => {
          const result = await flushListAction(listId);
          if (!result.ok) throw new Error(result.error);
          toast({
            title: `Flushed ${listName}`,
            description: `${formatNumber(result.data.members)} numbers reset.`,
            variant: "success",
          });
          router.refresh();
        }}
      />
    </>
  );
}
