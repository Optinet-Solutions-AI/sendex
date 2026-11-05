"use client";

import {
  analyseSmsText,
  hasDomainPlaceholder,
  splitAdTexts,
  TEXT_PLACEHOLDERS,
} from "@sendex/core";
import { useId, useRef, useState } from "react";
import { Button, Chips, ErrorText, Field, inputClass, Toggle } from "./ui";

const CHIPS = TEXT_PLACEHOLDERS.map((p) => ({ key: p.key, token: p.token, title: p.description }));

export interface AdTextEditorProps {
  initial?: string;
  /** Several texts separated by a `//` line (add) or a single text (edit). */
  multi: boolean;
  pending: boolean;
  error: string | null;
  onSave: (input: { text: string; requireDomain: boolean }) => void;
  onCancel: () => void;
}

/**
 * Textarea with placeholder chips, a GSM-7 / UCS-2 counter per text from `analyseSmsText`
 * and a "Check {{domain}} exists" toggle that blocks saving while a text lacks it.
 */
export function AdTextEditor({
  initial = "",
  multi,
  pending,
  error,
  onSave,
  onCancel,
}: AdTextEditorProps) {
  const id = useId();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState(initial);
  const [requireDomain, setRequireDomain] = useState(true);
  const texts = multi ? splitAdTexts(text) : text.trim() ? [text.trim()] : [];
  const missingDomain = requireDomain && texts.some((t) => !hasDomainPlaceholder(t));
  // Keys that survive duplicates without falling back to the array index.
  const seen = new Map<string, number>();
  const entries = texts.map((text) => {
    const n = (seen.get(text) ?? 0) + 1;
    seen.set(text, n);
    return { text, key: `${text}#${n}` };
  });
  const canSave = texts.length > 0 && !missingDomain && !pending;

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

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSave) onSave({ text, requireDomain });
      }}
    >
      <Chips items={CHIPS} onPick={insert} />
      <Field
        label={multi ? "Texts" : "Text"}
        htmlFor={`${id}-text`}
        hint={
          multi
            ? "Several texts: separate them with a line containing only //. Use {word1|word2} to randomise words."
            : "Use {word1|word2} to randomise words."
        }
      >
        <textarea
          id={`${id}-text`}
          ref={ref}
          className={`${inputClass} h-40 font-mono`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          data-testid="ad-text-input"
        />
      </Field>
      <ul className="space-y-1 text-xs" aria-label="Counter" data-testid="ad-text-counter">
        {texts.length === 0 ? (
          <li className="text-neutral-500">Type a text to see its size.</li>
        ) : null}
        {entries.map(({ text: t, key }, i) => {
          const a = analyseSmsText(t);
          const domain = hasDomainPlaceholder(t);
          return (
            <li key={key} className="flex flex-wrap items-center gap-2">
              <span className="font-medium">Text {i + 1}:</span>
              <span className="rounded bg-neutral-100 px-1.5 font-mono">
                {a.encoding === "GSM_7BIT" ? "GSM-7" : "UCS-2"}
              </span>
              <span>{a.chars} chars</span>
              <span data-testid={`ad-text-parts-${i + 1}`}>
                {a.parts} {a.parts === 1 ? "part" : "parts"}
              </span>
              <span className="text-neutral-500">{a.left} left</span>
              {!domain ? (
                <span className={requireDomain ? "text-red-600" : "text-amber-600"}>
                  no {"{{domain}}"}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
      <div className="flex items-center gap-2 text-sm">
        <Toggle
          name="require-domain"
          label="Check {{domain}} exists"
          checked={requireDomain}
          onChange={setRequireDomain}
        />
        <span>Check {"{{domain}}"} exists</span>
      </div>
      {missingDomain ? (
        <p className="text-xs text-red-600">
          Every text needs {"{{domain}}"} so the tracked link is inserted. Switch the check off to
          save anyway.
        </p>
      ) : null}
      <ErrorText error={error} />
      <div className="flex justify-end gap-2">
        <Button onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={!canSave} data-testid="save-ad-text">
          {pending
            ? "Saving…"
            : multi
              ? `Add ${texts.length || ""} text${texts.length === 1 ? "" : "s"}`
              : "Save"}
        </Button>
      </div>
    </form>
  );
}
