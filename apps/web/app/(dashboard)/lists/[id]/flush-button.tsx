"use client";

import { Button, ConfirmDialog, useToast } from "@sendex/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatNumber } from "../../../../lib/format";
import { flushListAction } from "../actions";

export function FlushButton({ listId, listName }: { listId: string; listName: string }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { toast } = useToast();
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        Flush
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
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
