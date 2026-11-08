"use client";

import { adTextProblem, analyseAdText, splitAdTexts } from "@sendex/core";
import { Button, Toggle, Tooltip } from "@sendex/ui";
import { ChevronDown, Info } from "lucide-react";
import { useId, useRef, useState } from "react";
import { ErrorText, inputClass } from "./ui";

/** The insert chips of the spec, in its order. */
const PRIMARY_CHIPS: ReadonlyArray<{ label: string; token: string; title?: string }> = [
  { label: "Domain", token: "{{domain}}", title: "The tracked short link of the active offer" },
  { label: "First Name", token: "{{first_name}}" },
  { label: "Phone", token: "{{phone}}" },
  {
    label: "Words Randomizer",
    token: "{word1|word2}",
    title: "One of the words is picked per message: {word1|word2}",
  },
];
const MORE_CHIPS: ReadonlyArray<{ label: string; token: string }> = [
  { label: "Last Name", token: "{{last_name}}" },
];

export interface AdTextSave {
  text: string;
  requireDomain: boolean;
  longMessage: boolean;
}

export interface AdTextEditorProps {
  initial?: string;
  /** Several texts separated by a `//` line (add) or a single text (edit). */
  multi: boolean;
  pending: boolean;
  error: string | null;
  /** Characters `{{domain}}` becomes when sent, so the counter shows the parts that are billed. */
  linkLength: number;
  onSave: (input: AdTextSave) => void;
  onCancel: () => void;
}

/**
 * The Add Ad Texts dialog body of the spec: insert chips, the textarea, the live counter in
 * red monospace (`GSM_7BIT · 0 chars · 1 part · 160 left`), "Check {{domain}} exists" (on)
 * and "Long message" (off) toggles, Cancel and Add Text. The counter counts `{{domain}}` at
 * the real short link length; the server applies the same `adTextProblem` check.
 */
export function AdTextEditor({
  initial = "",
  multi,
  pending,
  error,
  linkLength,
  onSave,
  onCancel,
}: AdTextEditorProps) {
  const id = useId();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState(initial);
  const [requireDomain, setRequireDomain] = useState(true);
  // Off by default (as SMS Edge); on when editing a text that is already longer than one part.
  const [longMessage, setLongMessage] = useState(
    () => initial.trim() !== "" && analyseAdText(initial.trim(), linkLength).parts > 1,
  );
  const [moreOpen, setMoreOpen] = useState(false);
  const texts = multi ? splitAdTexts(text) : text.trim() ? [text.trim()] : [];
  const seen = new Map<string, number>();
  const entries = texts.map((t) => {
    const n = (seen.get(t) ?? 0) + 1;
    seen.set(t, n);
    return { text: t, key: `${t}#${n}`, analysis: analyseAdText(t, linkLength) };
  });
  const problem =
    texts
      .map((t) => adTextProblem(t, { requireDomain, longMessage, linkLength }))
      .find((p) => p !== null) ?? null;
  const canSave = texts.length > 0 && problem === null && !pending;
  const first = entries[0]?.analysis ?? analyseAdText("", linkLength);

  function insert(token: string) {
    const area = ref.current;
    if (!area) {
      setText((t) => t + token);
      return;
    }
    const start = area.selectionStart ?? text.length;
    const end = area.selectionEnd ?? text.length;
    const next = `${text.slice(0, start)}${token}${text.slice(end)}`;
    setText(next);
    requestAnimationFrame(() => {
      area.focus();
      area.setSelectionRange(start + token.length, start + token.length);
    });
  }

  const chip = (c: { label: string; token: string; title?: string }) => (
    <button
      key={c.token}
      type="button"
      onClick={() => insert(c.token)}
      className="inline-flex items-center gap-1 rounded-full border border-rule bg-page px-2 py-0.5 text-xs text-ink hover:border-navy"
    >
      {c.label}
      {c.title ? (
        <Tooltip content={c.title}>
          <Info className="h-3 w-3 text-muted" aria-label={c.title} />
        </Tooltip>
      ) : null}
    </button>
  );

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSave) onSave({ text, requireDomain, longMessage });
      }}
    >
      <p className="text-sm text-muted">
        Line breaks are kept in the message.
        {multi ? (
          <>
            {" "}
            To add several texts at once, separate them with a line containing only{" "}
            <code className="rounded bg-page px-1 font-mono">{"//"}</code>. Nothing is saved unless
            every text is valid.
          </>
        ) : null}
      </p>
      <div className="flex flex-wrap items-center gap-1">
        {PRIMARY_CHIPS.map(chip)}
        <div className="relative">
          <button
            type="button"
            onClick={() => setMoreOpen((o) => !o)}
            aria-expanded={moreOpen}
            className="inline-flex items-center gap-1 rounded-full border border-rule bg-page px-2 py-0.5 text-xs text-ink hover:border-navy"
          >
            More <ChevronDown className="h-3 w-3" aria-hidden="true" />
          </button>
          {moreOpen ? (
            <div className="absolute left-0 z-10 mt-1 flex flex-col rounded-md border border-rule bg-surface p-1 shadow-md">
              {MORE_CHIPS.map((c) => (
                <button
                  key={c.token}
                  type="button"
                  onClick={() => {
                    insert(c.token);
                    setMoreOpen(false);
                  }}
                  className="rounded px-2 py-1 text-left text-xs hover:bg-neutral-100"
                >
                  {c.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      <textarea
        id={`${id}-text`}
        ref={ref}
        aria-label={multi ? "Ad texts" : "Ad text"}
        className={`${inputClass} h-40 font-mono`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={
          multi
            ? "First ad text with {{domain}} inside\n//\nSecond ad text — newlines stay in the message"
            : "Ad text with {{domain}} inside"
        }
        data-testid="ad-text-input"
      />
      <div
        className="font-mono text-xs text-signal"
        aria-live="polite"
        data-testid="ad-text-counter"
      >
        {entries.length <= 1 ? (
          <span>
            {first.encoding} · {first.chars} chars ·{" "}
            <span data-testid="ad-text-parts-1">
              {first.parts} {first.parts === 1 ? "part" : "parts"}
            </span>{" "}
            · {first.left} left
          </span>
        ) : (
          <ul className="space-y-0.5">
            {entries.map(({ key, analysis: a }, i) => (
              <li key={key}>
                Text {i + 1}: {a.encoding} · {a.chars} chars ·{" "}
                <span data-testid={`ad-text-parts-${i + 1}`}>
                  {a.parts} {a.parts === 1 ? "part" : "parts"}
                </span>{" "}
                · {a.left} left
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-6">
        <Toggle
          name="require-domain"
          label="Check {{domain}} exists"
          checked={requireDomain}
          onCheckedChange={setRequireDomain}
        />
        <Toggle
          name="long-message"
          label="Long message"
          hint="allow more than one SMS part"
          checked={longMessage}
          onCheckedChange={setLongMessage}
        />
      </div>
      {problem ? (
        <p className="text-xs text-signal" data-testid="ad-text-problem">
          {problem}
        </p>
      ) : null}
      <ErrorText error={error} />
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={!canSave} data-testid="save-ad-text">
          {pending ? "Saving…" : multi ? "Add Text" : "Save"}
        </Button>
      </div>
    </form>
  );
}
