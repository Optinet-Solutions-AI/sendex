"use client";

import { LINK_PLACEHOLDERS } from "@sendex/core";
import { useId, useState, useTransition } from "react";
import {
  attachLinkAction,
  createLinkAction,
  detachLinkAction,
  toggleCampaignLinkAction,
} from "../../app/(dashboard)/campaigns/actions";
import type { CampaignView, LinkOption } from "./types";
import { Button, Chips, ErrorText, Field, inputClass, Panel, Toggle } from "./ui";

const CHIPS = LINK_PLACEHOLDERS.map((key) => ({ key, token: `{{${key}}}` }));

/** "Offers" in SMS Edge: add or attach a tracked link; table with on/off and remove. */
export function LinksPanel({
  campaign,
  links,
  onChanged,
}: {
  campaign: CampaignView;
  links: LinkOption[];
  onChanged: () => void;
}) {
  const id = useId();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [existing, setExisting] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const attached = new Set(campaign.links.map((l) => l.id));
  const available = links.filter((l) => !attached.has(l.id));

  function create() {
    setError(null);
    start(async () => {
      const result = await createLinkAction({ campaignId: campaign.id, name, url });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setName("");
      setUrl("");
      onChanged();
    });
  }

  function attach() {
    if (!existing) return;
    setError(null);
    start(async () => {
      const result = await attachLinkAction({ campaignId: campaign.id, linkId: existing });
      if (!result.ok) setError(result.error);
      else {
        setExisting("");
        onChanged();
      }
    });
  }

  function toggle(linkId: string, active: boolean) {
    start(async () => {
      const result = await toggleCampaignLinkAction({ campaignId: campaign.id, linkId, active });
      if (!result.ok) setError(result.error);
      else onChanged();
    });
  }

  function remove(linkId: string) {
    start(async () => {
      const result = await detachLinkAction({ campaignId: campaign.id, linkId });
      if (!result.ok) setError(result.error);
      else onChanged();
    });
  }

  return (
    <Panel title="Links" testId="links-panel">
      <div className="space-y-4">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-neutral-500">
            <tr>
              <th className="py-1">Name</th>
              <th className="py-1">URL</th>
              <th className="py-1">On</th>
              <th className="py-1" />
            </tr>
          </thead>
          <tbody>
            {campaign.links.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-2 text-xs text-neutral-500">
                  No links attached. Texts use {"{{domain}}"} for the tracked link.
                </td>
              </tr>
            ) : null}
            {campaign.links.map((link) => (
              <tr key={link.id} className="border-t border-neutral-100">
                <td className="py-1.5 pr-2 font-medium">{link.name}</td>
                <td className="max-w-xs truncate py-1.5 pr-2 font-mono text-xs text-neutral-600">
                  {link.url}
                </td>
                <td className="py-1.5">
                  <Toggle
                    label={`${link.name} ${link.active ? "on" : "off"}`}
                    checked={link.active}
                    onChange={(next) => toggle(link.id, next)}
                    disabled={pending}
                  />
                </td>
                <td className="py-1.5 text-right">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => remove(link.id)}
                    disabled={pending}
                  >
                    Remove
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {available.length > 0 ? (
          <div className="flex items-end gap-2">
            <Field label="Attach an existing link" htmlFor={`${id}-existing`}>
              <select
                id={`${id}-existing`}
                className={inputClass}
                value={existing}
                onChange={(e) => setExisting(e.target.value)}
              >
                <option value="">Pick a link</option>
                {available.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </Field>
            <Button onClick={attach} disabled={pending || existing === ""}>
              Attach
            </Button>
          </div>
        ) : null}

        <form
          className="space-y-2 rounded border border-dashed border-neutral-300 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            create();
          }}
        >
          <h4 className="text-xs font-semibold uppercase text-neutral-500">Add link</h4>
          <Field label="Name" htmlFor={`${id}-name`}>
            <input
              id={`${id}-name`}
              className={inputClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
            />
          </Field>
          <Field
            label="URL"
            htmlFor={`${id}-url`}
            hint="Click a placeholder to append it to the URL."
          >
            <input
              id={`${id}-url`}
              className={`${inputClass} font-mono`}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://trk.example.com/click?o=75&sub_id1={{dynamic}}"
            />
          </Field>
          <Chips items={CHIPS} onPick={(token) => setUrl((u) => `${u}${token}`)} />
          <div className="flex justify-end">
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={pending || name.trim() === "" || url.trim() === ""}
            >
              Add link
            </Button>
          </div>
        </form>
        <ErrorText error={error} />
      </div>
    </Panel>
  );
}
