"use client";

import { useEffect, useState, useTransition } from "react";
import { setCampaignListsAction } from "../../app/(dashboard)/campaigns/actions";
import type { CampaignView, ListOption } from "./types";
import { ErrorText, Panel } from "./ui";

/** Multi-select of the organisation's lists for the campaign country with numbers left. */
export function ListsPanel({
  campaign,
  lists,
  onChanged,
}: {
  campaign: CampaignView;
  lists: ListOption[];
  onChanged: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // Optimistic: the checkbox flips at once and is re-synced when the server data comes back.
  const fromServer = campaign.lists.map((l) => l.id).join(",");
  const [selected, setSelected] = useState<string[]>(() => campaign.lists.map((l) => l.id));
  useEffect(() => {
    setSelected(fromServer ? fromServer.split(",") : []);
  }, [fromServer]);

  function toggle(listId: string, checked: boolean) {
    const next = checked
      ? [...new Set([...selected, listId])]
      : selected.filter((id) => id !== listId);
    setSelected(next);
    setError(null);
    start(async () => {
      const result = await setCampaignListsAction({ campaignId: campaign.id, listIds: next });
      if (!result.ok) setError(result.error);
      else onChanged();
    });
  }

  return (
    <Panel title="Lists" testId="lists-panel">
      {lists.length === 0 ? (
        <p className="text-xs text-neutral-500">
          No lists for {campaign.country} yet. Upload one under Lists.
        </p>
      ) : (
        <ul className="divide-y divide-neutral-100">
          {lists.map((list) => (
            <li key={list.id} className="flex items-center justify-between py-1.5">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={selected.includes(list.id)}
                  disabled={pending}
                  onChange={(e) => toggle(list.id, e.target.checked)}
                  data-testid={`list-${list.id}`}
                />
                <span>{list.name}</span>
              </label>
              <span className="text-xs text-neutral-500">
                {list.available.toLocaleString("en-GB")} left of{" "}
                {list.numbersCount.toLocaleString("en-GB")}
              </span>
            </li>
          ))}
        </ul>
      )}
      <ErrorText error={error} />
    </Panel>
  );
}
