"use client";

import { Button, ConfirmDialog, useToast } from "@sendex/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useReauthAction } from "../../../../lib/use-reauth-action";
import { rotatePostbackSecretAction } from "./actions";

/** Owner-only: replaces the postback secret after confirmation (and a recent sign-in). */
export function RotateSecretButton() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { toast } = useToast();
  const rotateSecret = useReauthAction(rotatePostbackSecretAction);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)} data-testid="rotate-secret">
        Rotate secret
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Rotate the postback secret?"
        description="Postbacks signed with the current secret are rejected from now on. Give the brand the new secret before their next conversion."
        confirmLabel="Rotate secret"
        destructive
        onConfirm={async () => {
          const result = await rotateSecret();
          if (!result.ok) throw new Error(result.error);
          toast({
            title: "Postback secret rotated",
            description: "Update the brand's tracker with the new secret.",
            variant: "success",
          });
          router.refresh();
        }}
      />
    </>
  );
}
