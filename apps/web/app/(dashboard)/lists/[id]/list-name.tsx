"use client";

import { IconButton } from "@sendex/ui";
import { Check, Pencil, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { renameListAction } from "../actions";

/**
 * The list's name in the page title with a pencil to rename it (D4-27), as on a campaign:
 * Enter or the tick saves, Escape or the cross cancels. A span, not a form: the title sits
 * inside the page's h1.
 */
export function ListName({
  listId,
  name,
  canEdit,
}: {
  listId: string;
  name: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function save() {
    const next = draft.trim();
    // As on a campaign: an empty or unchanged name just closes the field.
    if (next === "" || next === name) {
      cancel();
      return;
    }
    setError(null);
    start(async () => {
      const result = await renameListAction({ listId, name: next });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setEditing(false);
      router.refresh();
    });
  }

  function cancel() {
    setEditing(false);
    setDraft(name);
    setError(null);
  }

  if (!editing) {
    return (
      <span className="inline-flex items-center gap-2">
        <span data-testid="list-name">{name}</span>
        {canEdit ? (
          <IconButton
            label="Rename list"
            icon={<Pencil />}
            onClick={() => {
              setDraft(name);
              setEditing(true);
            }}
          />
        ) : null}
      </span>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-2">
      <input
        aria-label="List name"
        // biome-ignore lint/a11y/noAutofocus: the field opens on purpose, from the pencil.
        autoFocus
        maxLength={100}
        value={draft}
        disabled={pending}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") save();
          if (event.key === "Escape") cancel();
        }}
        className="min-w-0 rounded-md border border-rule bg-surface px-2 py-1 text-2xl font-semibold text-ink"
      />
      <IconButton
        type="button"
        label="Save name"
        icon={<Check />}
        disabled={pending}
        onClick={save}
      />
      <IconButton type="button" label="Cancel rename" icon={<X />} onClick={cancel} />
      {error ? (
        <span role="alert" className="text-sm font-normal text-red-700">
          {error}
        </span>
      ) : null}
    </span>
  );
}
