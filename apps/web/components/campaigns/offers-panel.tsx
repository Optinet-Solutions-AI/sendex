"use client";

import { Button, EmptyState, IconButton, Toggle, Tooltip } from "@sendex/ui";
import { ChevronDown, ChevronRight, Tag, Trash2 } from "lucide-react";
import { useId, useState, useTransition } from "react";
import {
  attachLinkAction,
  createLinkAction,
  detachLinkAction,
  toggleCampaignLinkAction,
} from "../../app/(dashboard)/campaigns/actions";
import { formatMicro } from "./format";
import type { CampaignView, LinkOption } from "./types";
import { ErrorText, Field, inputClass } from "./ui";

/** The token chips of the spec, in its order, mapped to our placeholders. */
export const OFFER_TOKENS: ReadonlyArray<{ label: string; token: string }> = [
  { label: "Dynamic", token: "{{dynamic}}" },
  { label: "Geo", token: "{{geo}}" },
  { label: "Ad Text ID", token: "{{ad_text_id}}" },
  { label: "List ID", token: "{{list_id}}" },
  { label: "Phone", token: "{{phone}}" },
  { label: "First Name", token: "{{first_name}}" },
  { label: "Last Name", token: "{{last_name}}" },
  { label: "Email", token: "{{email}}" },
  { label: "Campaign ID", token: "{{campaign_id}}" },
  { label: "Campaign Name", token: "{{campaign_name}}" },
  { label: "Route Name", token: "{{route_name}}" },
  { label: "Custom 1", token: "{{custom1}}" },
  { label: "Custom 2", token: "{{custom2}}" },
  { label: "Custom 3", token: "{{custom3}}" },
  { label: "Custom 4", token: "{{custom4}}" },
  { label: "Custom 5", token: "{{custom5}}" },
  { label: "Offer ID", token: "{{link_id}}" },
  { label: "Cost Per Sending", token: "{{cost}}" },
];

const NEW_OFFER = "__new__";

/**
 * The Offers context tab of the spec: OFFER (— New offer — or an existing one), NAME (for
 * internal use), URL with the token chips, › Advanced › PROFIT (€), Add Offer; below it the
 * attached offers with an on/off switch and remove, or "No offers · This campaign has no
 * offers attached yet."
 */
export function OffersPanel({
  campaign,
  links,
  onChanged,
}: {
  campaign: CampaignView;
  links: LinkOption[];
  onChanged: () => void;
}) {
  const id = useId();
  const [offer, setOffer] = useState(NEW_OFFER);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [profit, setProfit] = useState("0");
  const [advanced, setAdvanced] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const attached = new Set(campaign.links.map((l) => l.id));
  const available = links.filter((l) => !attached.has(l.id));
  const isNew = offer === NEW_OFFER;

  function submit() {
    setError(null);
    start(async () => {
      const result = isNew
        ? await createLinkAction({ campaignId: campaign.id, name, url, profitEur: profit || "0" })
        : await attachLinkAction({ campaignId: campaign.id, linkId: offer });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOffer(NEW_OFFER);
      setName("");
      setUrl("");
      setProfit("0");
      onChanged();
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

  function insert(token: string) {
    setUrl((u) => `${u}${token}`);
  }

  return (
    <div className="space-y-5" data-testid="links-panel">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label="Offer" htmlFor={`${id}-offer`}>
          <select
            id={`${id}-offer`}
            className={inputClass}
            value={offer}
            onChange={(e) => setOffer(e.target.value)}
          >
            <option value={NEW_OFFER}>— New offer —</option>
            {available.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </Field>
        {isNew ? (
          <>
            <Field label="Name (for internal use)" htmlFor={`${id}-name`}>
              <input
                id={`${id}-name`}
                className={inputClass}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My offer"
                maxLength={120}
              />
            </Field>
            <Field label="URL" htmlFor={`${id}-url`}>
              <input
                id={`${id}-url`}
                className={`${inputClass} font-mono`}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/landing?id={{dynamic}}"
              />
            </Field>
            <div className="flex flex-wrap gap-1">
              {OFFER_TOKENS.map((t) => (
                <Tooltip key={t.token} content={t.token}>
                  <button
                    type="button"
                    onClick={() => insert(t.token)}
                    className="rounded-full border border-rule bg-page px-2 py-0.5 text-xs text-ink hover:border-navy"
                  >
                    {t.label}
                  </button>
                </Tooltip>
              ))}
            </div>
            <div>
              <button
                type="button"
                onClick={() => setAdvanced((a) => !a)}
                aria-expanded={advanced}
                className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink"
              >
                {advanced ? (
                  <ChevronDown className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                )}
                Advanced
              </button>
              {advanced ? (
                <div className="mt-2">
                  <Field
                    label="Profit (€)"
                    htmlFor={`${id}-profit`}
                    hint="Revenue per conversion, for profit and ROI."
                  >
                    <input
                      id={`${id}-profit`}
                      type="number"
                      min={0}
                      step="0.01"
                      className={`${inputClass} w-40`}
                      value={profit}
                      onChange={(e) => setProfit(e.target.value)}
                    />
                  </Field>
                </div>
              ) : null}
            </div>
          </>
        ) : null}
        <div className="flex justify-end">
          <Button
            type="submit"
            size="sm"
            disabled={pending || (isNew && (name.trim() === "" || url.trim() === ""))}
          >
            Add Offer
          </Button>
        </div>
      </form>

      {campaign.links.length === 0 ? (
        <EmptyState
          icon={<Tag />}
          title="No offers"
          hint="This campaign has no offers attached yet."
        />
      ) : (
        <ul className="divide-y divide-rule rounded-md border border-rule bg-surface">
          {campaign.links.map((link) => (
            <li key={link.id} className="flex items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div
                  className={`text-sm font-medium ${link.active ? "text-ink" : "text-muted line-through"}`}
                >
                  {link.name}
                  {link.profitMicro > 0 ? (
                    <span className="ml-2 font-mono text-xs text-muted">
                      profit {formatMicro(link.profitMicro)}
                    </span>
                  ) : null}
                </div>
                <div className="truncate font-mono text-xs text-muted">{link.url}</div>
              </div>
              <Toggle
                label={`${link.name} ${link.active ? "on" : "off"}`}
                labelHidden
                checked={link.active}
                onCheckedChange={(next) => toggle(link.id, next)}
                disabled={pending}
              />
              <IconButton
                label={`Remove ${link.name}`}
                tooltip="Remove from campaign"
                icon={<Trash2 />}
                tone="danger"
                disabled={pending}
                onClick={() => remove(link.id)}
              />
            </li>
          ))}
        </ul>
      )}
      <ErrorText error={error} />
    </div>
  );
}
