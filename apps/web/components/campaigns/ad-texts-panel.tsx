"use client";

import { renderPreview } from "@sendex/core";
import { useState, useTransition } from "react";
import {
  addAdTextsAction,
  toggleAdTextAction,
  updateAdTextAction,
} from "../../app/(dashboard)/campaigns/actions";
import { AdTextEditor } from "./ad-text-editor";
import type { AdTextView, CampaignView } from "./types";
import { Button, ErrorText, Modal, Panel, Toggle } from "./ui";

const SAMPLE = {
  domain: "https://snd.ex/a1b2c3",
  first_name: "Ana",
  last_name: "García",
  phone: "+34600123456",
  opt_out: "STOP to 12345",
} as const;

/** Table of the campaign's texts (preview, parts, on/off, edit) and the Add Texts dialog. */
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
    <Panel
      title="Ad Texts"
      testId="ad-texts-panel"
      action={
        <Button size="sm" onClick={() => setAdding(true)} data-testid="add-texts">
          Add Texts
        </Button>
      }
    >
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase text-neutral-500">
          <tr>
            <th className="py-1">#</th>
            <th className="py-1">Preview</th>
            <th className="py-1">Encoding</th>
            <th className="py-1 text-right">Parts</th>
            <th className="py-1">On</th>
            <th className="py-1" />
          </tr>
        </thead>
        <tbody>
          {campaign.adTexts.length === 0 ? (
            <tr>
              <td colSpan={6} className="py-2 text-xs text-neutral-500">
                No texts yet. Add at least one with {"{{domain}}"}.
              </td>
            </tr>
          ) : null}
          {campaign.adTexts.map((t, i) => (
            <tr
              key={t.id}
              className="border-t border-neutral-100 align-top"
              data-testid="ad-text-row"
            >
              <td className="py-1.5 pr-2 text-neutral-500">{i + 1}</td>
              <td className="py-1.5 pr-2">
                <div className={t.active ? "" : "text-neutral-400"}>
                  {renderPreview(t.text, SAMPLE)}
                </div>
                <div className="mt-0.5 font-mono text-[11px] text-neutral-500">{t.text}</div>
              </td>
              <td className="py-1.5 pr-2 text-xs">
                {t.encoding === "GSM_7BIT" ? "GSM-7" : "UCS-2"}
              </td>
              <td className="py-1.5 pr-2 text-right">{t.parts}</td>
              <td className="py-1.5 pr-2">
                <Toggle
                  label={`Text ${i + 1} ${t.active ? "on" : "off"}`}
                  checked={t.active}
                  onChange={(next) => toggle(t.id, next)}
                  disabled={pending}
                />
              </td>
              <td className="py-1.5 text-right">
                <Button size="sm" variant="ghost" onClick={() => setEditing(t)} disabled={pending}>
                  Edit
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ErrorText error={error} />

      <Modal open={adding} title="Add Texts" onClose={() => setAdding(false)} wide>
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
    </Panel>
  );
}
