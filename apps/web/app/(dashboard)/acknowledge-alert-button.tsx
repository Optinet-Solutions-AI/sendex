"use client";

import { Button, useToast } from "@sendex/ui";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { acknowledgeAlertAction } from "./alerts-actions";

/** The owner's "Acknowledge" button on one alert of the dashboard banner. */
export function AcknowledgeAlertButton({ alertId }: { alertId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      data-testid="acknowledge-alert"
      onClick={() =>
        startTransition(async () => {
          const result = await acknowledgeAlertAction(alertId);
          if (!result.ok) {
            toast({ title: "Could not acknowledge the alert", description: result.error });
          } else {
            toast({ title: "Alert acknowledged", variant: "success" });
          }
          router.refresh();
        })
      }
    >
      {pending ? "Acknowledging…" : "Acknowledge"}
    </Button>
  );
}
