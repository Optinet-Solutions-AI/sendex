"use client";

import { renderPreview } from "@sendex/core";
import { Button, EmptyState, IconButton, Toggle } from "@sendex/ui";
import { MessageSquareText, Pencil, Plus } from "lucide-react";
import { useState, useTransition } from "react";
import {
  addAdTextsAction,
  toggleAdTextAction,
  updateAdTextAction,
} from "../../app/(dashboard)/campaigns/actions";
import { AdTextEditor } from "./ad-text-editor";
import type { AdTextView, CampaignView } from "./types";
import { ErrorText, Modal } from "./ui";

const SAMPLE = {
  domain: "https://snd.ex/a1b2c3",
  first_name: "Ana",
  last_name: "García",
  phone: "+34600123456",
  opt_out: "STOP to 12345",
} as const;

/** The Ad Texts context tab: "AD TEXTS" with + Add Texts, the texts with their switch, and the dialogs. */
export function AdTextsPanel({
  campaign,
  onChanged,
}: {
  campaign: CampaignView;
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<AdTextView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function add(input: { text: string; requireDomain: boolean }) {
    setError(null);
    start(async () => {
      const result = await addAdTextsAction({
        campaignId: campaign.id,
        input: input.text,
        requireDomain: input.requireDomain,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setAdding(false);
      onChanged();
    });
  }

  function save(adTextId: string, input: { text: string; requireDomain: boolean }) {
    setError(null);
    start(async () => {
      const result = await updateAdTextAction({
        campaignId: campaign.id,
        adTextId,
        text: input.text,
        requireDomain: input.requireDomain,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setEditing(null);
      onChanged();
    });
  }

  function toggle(adTextId: string, active: boolean) {
    start(async () => {
      const result = await toggleAdTextAction({ campaignId: campaign.id, adTextId, active });
      if (!result.ok) setError(result.error);
      else onChanged();
    });
  }

  return (
    <div className="space-y-3" data-testid="ad-texts-panel">
      <div className="flex items-center justify-between">
        <h4 className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted">Ad texts</h4>
        <Button size="sm" variant="outline" onClick={() => setAdding(true)} data-testid="add-texts">
          <Plus className="h-4 w-4" aria-hidden="true" /> Add Texts
        </Button>
      </div>
      {campaign.adTexts.length === 0 ? (
        <EmptyState icon={<MessageSquareText />} title="No ad texts yet." />
      ) : (
        <ul className="divide-y divide-rule rounded-md border border-rule bg-surface">
          {campaign.adTexts.map((t, i) => (
            <li key={t.id} className="flex items-start gap-3 px-3 py-2" data-testid="ad-text-row">
              <span className="pt-0.5 font-mono text-xs text-muted">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className={`text-sm ${t.active ? "text-ink" : "text-muted"}`}>
                  {renderPreview(t.text, SAMPLE)}
                </div>
                <div className="mt-0.5 font-mono text-[11px] text-muted">
                  {t.encoding} · {t.parts} {t.parts === 1 ? "part" : "parts"}
                </div>
              </div>
              <Toggle
                label={`Text ${i + 1} ${t.active ? "on" : "off"}`}
                labelHidden
                checked={t.active}
                onCheckedChange={(next) => toggle(t.id, next)}
                disabled={pending}
              />
              <IconButton
                label={`Edit text ${i + 1}`}
                tooltip="Edit"
                icon={<Pencil />}
                disabled={pending}
                onClick={() => setEditing(t)}
              />
            </li>
          ))}
        </ul>
      )}
      <ErrorText error={error} />

      <Modal open={adding} title="Add Ad Texts" onClose={() => setAdding(false)} wide>
        <AdTextEditor
          multi
          pending={pending}
          error={error}
          onSave={add}
          onCancel={() => setAdding(false)}
        />
      </Modal>
      <Modal open={editing !== null} title="Edit text" onClose={() => setEditing(null)} wide>
        {editing ? (
          <AdTextEditor
            key={editing.id}
            initial={editing.text}
            multi={false}
            pending={pending}
            error={error}
            onSave={(input) => save(editing.id, input)}
            onCancel={() => setEditing(null)}
          />
        ) : null}
      </Modal>
    </div>
  );
}
