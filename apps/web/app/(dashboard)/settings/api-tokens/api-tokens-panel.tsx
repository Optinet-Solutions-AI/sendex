"use client";

import {
  API_TOKEN_SCOPE_DESCRIPTIONS,
  API_TOKEN_SCOPES,
  type ApiTokenScope,
  tokenHasScope,
} from "@sendex/core";
import {
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Input,
  Label,
  useToast,
} from "@sendex/ui";
import { useRouter } from "next/navigation";
import { type FormEvent, useState, useTransition } from "react";
import { formatDateTime } from "../../../../lib/format";
import { type CreatedApiTokenView, createApiTokenAction, revokeApiTokenAction } from "./actions";

export interface ApiTokenView {
  id: string;
  name: string;
  prefix: string;
  scopes: ApiTokenScope[];
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

function isScope(value: string): value is ApiTokenScope {
  return (API_TOKEN_SCOPES as readonly string[]).includes(value);
}

/** The create form, the one-time reveal dialog and the token table with revoke. */
export function ApiTokensPanel({
  tokens,
  apiBaseUrl,
}: {
  tokens: ApiTokenView[];
  /** Public address of the worker; null while it is not deployed (no docs link to show). */
  apiBaseUrl: string | null;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<ApiTokenScope[]>(["read"]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [revealed, setRevealed] = useState<CreatedApiTokenView | null>(null);
  const [revoking, setRevoking] = useState<ApiTokenView | null>(null);

  function toggleScope(scope: ApiTokenScope, on: boolean) {
    setScopes((current) =>
      on ? [...new Set([...current, scope])] : current.filter((s) => s !== scope),
    );
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await createApiTokenAction({ name, scopes });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setName("");
      setScopes(["read"]);
      setRevealed(result.data);
      router.refresh();
    });
  }

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast({ title: "Copied to the clipboard", variant: "success" });
    } catch {
      toast({ title: "Could not copy; select the token and copy it by hand", variant: "error" });
    }
  }

  return (
    <div className="space-y-6">
      <form
        onSubmit={submit}
        className="space-y-4 rounded border border-neutral-200 bg-white p-5"
        data-testid="create-token-form"
      >
        <h2 className="text-sm font-semibold">Create a token</h2>
        <div className="space-y-1">
          <Label htmlFor="token-name">Name</Label>
          <Input
            id="token-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. CRM sync"
            maxLength={60}
            disabled={pending}
            className="max-w-sm"
          />
        </div>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Scopes</legend>
          {API_TOKEN_SCOPES.map((scope) => (
            <div key={scope} className="flex items-start gap-2">
              <Checkbox
                id={`scope-${scope}`}
                checked={tokenHasScope(scopes, scope)}
                onCheckedChange={(checked) => toggleScope(scope, checked === true)}
                disabled={pending}
                className="mt-0.5"
              />
              <Label htmlFor={`scope-${scope}`} className="font-normal">
                <span className="font-mono text-xs">{scope}</span>
                <span className="text-neutral-600"> · {API_TOKEN_SCOPE_DESCRIPTIONS[scope]}</span>
              </Label>
            </div>
          ))}
        </fieldset>
        {error ? (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        ) : null}
        <Button type="submit" disabled={pending} data-testid="create-token">
          {pending ? "Creating…" : "Create token"}
        </Button>
      </form>

      <Dialog open={revealed !== null} onOpenChange={(open) => !open && setRevealed(null)}>
        <DialogContent className="max-w-lg">
          <DialogTitle className="text-lg font-semibold">Copy your token now</DialogTitle>
          <DialogDescription className="mt-2 text-sm text-neutral-600">
            This is the only time <span className="font-medium">{revealed?.name}</span> is shown.
            Store it somewhere safe; if you lose it, revoke it and create a new one.
          </DialogDescription>
          <code
            className="mt-4 block overflow-x-auto whitespace-pre rounded bg-neutral-100 px-3 py-2 font-mono text-xs"
            data-testid="token-reveal"
          >
            {revealed?.token ?? ""}
          </code>
          {apiBaseUrl ? (
            <p className="mt-3 text-xs text-neutral-500">
              Use it as <code>Authorization: Bearer &lt;token&gt;</code> against{" "}
              <code>{apiBaseUrl}/api/v1</code>. Reference:{" "}
              <a
                href={`${apiBaseUrl}/api/docs`}
                className="underline"
                target="_blank"
                rel="noreferrer"
              >
                {apiBaseUrl}/api/docs
              </a>
              .
            </p>
          ) : (
            <p className="mt-3 text-xs text-amber-800" data-testid="worker-not-deployed">
              Use it as <code>Authorization: Bearer &lt;token&gt;</code>. The API address and its
              reference appear here once the worker service is deployed.
            </p>
          )}
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="outline" onClick={() => revealed && copy(revealed.token)}>
              Copy
            </Button>
            <Button onClick={() => setRevealed(null)} data-testid="token-reveal-done">
              Done
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <div className="overflow-x-auto rounded border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-neutral-200 text-left text-xs uppercase text-neutral-500">
            <tr>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Token</th>
              <th className="px-4 py-2">Scopes</th>
              <th className="px-4 py-2">Created</th>
              <th className="px-4 py-2">Last used</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {tokens.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-neutral-500">
                  No tokens yet.
                </td>
              </tr>
            ) : (
              tokens.map((token) => (
                <tr
                  key={token.id}
                  className="border-b border-neutral-100 last:border-0"
                  data-testid={`token-row-${token.id}`}
                >
                  <td className="px-4 py-2 font-medium">{token.name}</td>
                  <td className="px-4 py-2 font-mono text-xs">{token.prefix}…</td>
                  <td className="px-4 py-2 font-mono text-xs">
                    {token.scopes.filter(isScope).join(", ")}
                  </td>
                  <td className="px-4 py-2 text-neutral-600">{formatDateTime(token.createdAt)}</td>
                  <td className="px-4 py-2 text-neutral-600">
                    {token.lastUsedAt ? formatDateTime(token.lastUsedAt) : "never"}
                  </td>
                  <td className="px-4 py-2">
                    {token.revokedAt ? (
                      <Badge variant="secondary" title={formatDateTime(token.revokedAt)}>
                        Revoked
                      </Badge>
                    ) : (
                      <Badge>Active</Badge>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {token.revokedAt ? null : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setRevoking(token)}
                        data-testid={`revoke-${token.id}`}
                      >
                        Revoke
                      </Button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => !open && setRevoking(null)}
        title={`Revoke "${revoking?.name ?? ""}"?`}
        description="Every call made with this token answers 401 from now on. This cannot be undone; create a new token if you need access again."
        confirmLabel="Revoke token"
        destructive
        onConfirm={async () => {
          if (!revoking) return;
          const result = await revokeApiTokenAction({ id: revoking.id });
          if (!result.ok) throw new Error(result.error);
          toast({ title: "Token revoked", variant: "success" });
          router.refresh();
        }}
      />
    </div>
  );
}
