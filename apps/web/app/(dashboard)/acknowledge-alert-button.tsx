"use client";

import { Button, useToast } from "@sendex/ui";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { acknowledgeAlertsAction } from "./alerts-actions";

/** The owner's button that acknowledges one or more alerts of the dashboard banner. */
export function AcknowledgeAlertButton({
  alertIds,
  label = "Acknowledge",
  testId = "acknowledge-alert",
}: {
  alertIds: string[];
  label?: string;
  testId?: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      data-testid={testId}
      onClick={() =>
        startTransition(async () => {
          const result = await acknowledgeAlertsAction(alertIds);
          if (!result.ok) {
            toast({ title: "Could not acknowledge", description: result.error });
          } else {
            toast({
              title:
                result.acknowledged === 1
                  ? "Alert acknowledged"
                  : `${result.acknowledged} alerts acknowledged`,
              variant: "success",
            });
          }
          router.refresh();
        })
      }
    >
      {pending ? "Acknowledging…" : label}
    </Button>
  );
}
