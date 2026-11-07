"use client";

import { Button, Card, useToast } from "@sendex/ui";
import { Copy } from "lucide-react";

function UrlCard({ title, hint, url }: { title: string; hint: string; url: string }) {
  const { toast } = useToast();
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-ink">{title}</h3>
          <p className="text-xs text-muted">{hint}</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void navigator.clipboard.writeText(url).then(() => toast({ title: "URL copied" }));
          }}
        >
          <Copy className="h-3.5 w-3.5" aria-hidden="true" /> Copy
        </Button>
      </div>
      <pre className="mt-3 overflow-x-auto rounded-md bg-page p-3 font-mono text-xs text-ink">
        {url}
      </pre>
    </Card>
  );
}

/** The Unsubscribe API tab: the two URLs of the spec, by dynamic variable and by number. */
export function ApiTab({ byDynamic, byNumber }: { byDynamic: string; byNumber: string }) {
  return (
    <div className="space-y-4" data-testid="unsub-api">
      <p className="text-sm text-muted">
        Call these from your CRM or landing page to unsubscribe a contact in real time. Replace the
        placeholders in triple braces with the actual value. Both answer JSON and take effect at
        once, across every campaign of this account.
      </p>
      <UrlCard
        title="Unsubscribe by dynamic variable"
        hint="Use when you send a per-contact identifier with the campaign."
        url={byDynamic}
      />
      <UrlCard
        title="Unsubscribe by number"
        hint="Use when you have the phone number in international format."
        url={byNumber}
      />
    </div>
  );
}
