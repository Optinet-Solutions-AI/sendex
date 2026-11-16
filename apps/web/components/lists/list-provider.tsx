"use client";

import { Button, Input, useToast } from "@sendex/ui";
import { Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setListProviderAction } from "../../app/(dashboard)/lists/actions";

/**
 * Who supplied the list's data (D5-01), next to the country in the list header: shown as text,
 * with a pencil that turns it into a small form for people who may upload.
 */
export function ListProvider({
  listId,
  provider,
  canEdit,
}: {
  listId: string;
  provider: string | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(provider ?? "");
  const [pending, start] = useTransition();

  function save() {
    start(async () => {
      const result = await setListProviderAction(listId, value);
      if (!result.ok) {
        toast({ title: result.error, variant: "error" });
        return;
      }
      setEditing(false);
      toast({ title: "Data provider saved", variant: "success" });
      router.refresh();
    });
  }

  if (editing) {
    return (
      <form
        className="inline-flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <Input
          aria-label="Data provider"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={40}
          placeholder="e.g. ZEN"
          className="h-8 w-32"
          autoFocus
        />
        <Button type="submit" size="sm" disabled={pending}>
          Save
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            setValue(provider ?? "");
            setEditing(false);
          }}
        >
          Cancel
        </Button>
      </form>
    );
  }

  return (
    <span className="inline-flex items-center gap-1">
      Data provider: <span data-testid="list-provider">{provider ?? "not set"}</span>
      {canEdit ? (
        <button
          type="button"
          className="rounded p-1 text-muted hover:text-ink"
          aria-label="Edit data provider"
          onClick={() => setEditing(true)}
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      ) : null}
    </span>
  );
}
