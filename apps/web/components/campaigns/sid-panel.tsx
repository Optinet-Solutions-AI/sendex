"use client";

import { Button, EmptyState, Toggle, Tooltip } from "@sendex/ui";
import { ChevronDown, ChevronRight, Plus, Radio } from "lucide-react";
import { useId, useState, useTransition } from "react";
import {
  addSenderIdsAction,
  createSidGroupAction,
  setCampaignSidGroupAction,
  toggleSenderIdAction,
} from "../../app/(dashboard)/campaigns/actions";
import { formatPercent } from "./format";
import type { CampaignView, SidGroupView } from "./types";
import { ErrorText, Field, inputClass, Modal } from "./ui";

/** The SIDs select of the send form: "SID ES (17 active)" per group, one group per campaign. */
export function SidGroupSelect({
  campaign,
  groups,
  onChanged,
  onFocusTab,
}: {
  campaign: CampaignView;
  groups: SidGroupView[];
  onChanged: () => void;
  onFocusTab: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  function pickGroup(groupId: string) {
    if (!groupId) return;
    setError(null);
    start(async () => {
      const result = await setCampaignSidGroupAction({ campaignId: campaign.id, groupId });
      if (!result.ok) setError(result.error);
      else onChanged();
    });
  }
  return (
    <div>
      <select
        className={inputClass}
        value={campaign.sidGroup?.id ?? ""}
        onChange={(e) => pickGroup(e.target.value)}
        onFocus={onFocusTab}
        disabled={pending}
        aria-label="SID group"
        data-testid="sid-group-select"
      >
        <option value="">— select a SID group —</option>
        {groups.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name} ({g.activeCount} active)
          </option>
        ))}
      </select>
      <ErrorText error={error} />
    </div>
  );
}

/**
 * The SIDs context tab of the spec: the campaign's sender ids, then "SID groups — only one
 * group can be active" with a row per group (chevron, name, "10/10 SIDs active", "14,000
 * sent · 1.26% CTR", + Add SID, an activate toggle), member rows with their own toggles, and
 * the Add Sender IDs and New SID Group dialogs.
 */
export function SidPanel({
  campaign,
  groups,
  onChanged,
}: {
  campaign: CampaignView;
  groups: SidGroupView[];
  onChanged: () => void;
}) {
  const id = useId();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [newOpen, setNewOpen] = useState(false);
  const [addFor, setAddFor] = useState<SidGroupView | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [groupName, setGroupName] = useState("");
  const [groupSids, setGroupSids] = useState("");
  const [sidsInput, setSidsInput] = useState("");
  const [addResult, setAddResult] = useState<string | null>(null);
  const current = campaign.sidGroup;

  function activate(groupId: string) {
    setError(null);
    start(async () => {
      const result = await setCampaignSidGroupAction({ campaignId: campaign.id, groupId });
      if (!result.ok) setError(result.error);
      else onChanged();
    });
  }

  function createGroup() {
    setError(null);
    start(async () => {
      const result = await createSidGroupAction({
        campaignId: campaign.id,
        name: groupName,
        country: campaign.country,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (groupSids.trim() !== "") {
        const added = await addSenderIdsAction({
          campaignId: campaign.id,
          groupId: result.data.groupId,
          input: groupSids,
        });
        if (!added.ok) {
          setError(added.error);
          return;
        }
      }
      setGroupName("");
      setGroupSids("");
      setNewOpen(false);
      onChanged();
    });
  }

  function addSids() {
    if (!addFor) return;
    setError(null);
    start(async () => {
      const result = await addSenderIdsAction({
        campaignId: campaign.id,
        groupId: addFor.id,
        input: sidsInput,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setAddResult(
        `Added ${result.data.added} sender id${result.data.added === 1 ? "" : "s"}` +
          (result.data.skipped > 0 ? `, ${result.data.skipped} already in the group` : ""),
      );
      setSidsInput("");
      onChanged();
    });
  }

  function toggle(senderId: string, active: boolean) {
    start(async () => {
      const result = await toggleSenderIdAction({ campaignId: campaign.id, senderId, active });
      if (!result.ok) setError(result.error);
      else onChanged();
    });
  }

  const activeIds = current?.senderIds.filter((s) => s.active) ?? [];

  return (
    <div className="space-y-4" data-testid="sid-panel">
      <section className="rounded-md border border-rule bg-page p-3">
        <h4 className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted">Sender IDs</h4>
        {current && activeIds.length > 0 ? (
          <p className="mt-1 font-mono text-xs text-ink">
            {activeIds.map((s) => s.value).join(", ")}
          </p>
        ) : (
          <p className="mt-1 text-sm text-muted">
            No SID group selected and no sender-ID traffic yet.
          </p>
        )}
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h4 className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.06em] text-muted">
            <Radio className="h-3.5 w-3.5" aria-hidden="true" /> SID groups
            <span className="normal-case tracking-normal">— only one group can be active</span>
          </h4>
          <Button size="sm" variant="outline" onClick={() => setNewOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden="true" /> New group
          </Button>
        </div>
        {groups.length === 0 ? (
          <EmptyState
            title="No SID groups yet"
            hint="Create one to pick the sender ids this campaign rotates through."
          />
        ) : (
          <ul className="divide-y divide-rule rounded-md border border-rule bg-surface">
            {groups.map((g) => {
              const open = expanded[g.id] ?? g.id === current?.id;
              const isActive = g.id === current?.id;
              const ctr = g.sent > 0 ? g.clicks / g.sent : 0;
              return (
                <li key={g.id}>
                  <div className="flex flex-wrap items-center gap-2 px-3 py-2">
                    <Tooltip content={open ? "Collapse member SIDs" : "Show member SIDs"}>
                      <button
                        type="button"
                        aria-expanded={open}
                        aria-label={`${open ? "Collapse" : "Show"} member SIDs of ${g.name}`}
                        onClick={() => setExpanded((e) => ({ ...e, [g.id]: !open }))}
                        className="rounded p-1 text-muted hover:bg-neutral-100 hover:text-ink"
                      >
                        {open ? (
                          <ChevronDown className="h-4 w-4" aria-hidden="true" />
                        ) : (
                          <ChevronRight className="h-4 w-4" aria-hidden="true" />
                        )}
                      </button>
                    </Tooltip>
                    <span className="font-medium text-ink">{g.name}</span>
                    <span className="text-xs text-muted">
                      {g.activeCount}/{g.senderIds.length} SIDs active
                    </span>
                    <span className="font-mono text-xs text-muted">
                      {g.sent.toLocaleString("en-GB")} sent · {formatPercent(ctr)} CTR
                    </span>
                    <div className="ml-auto flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setAddFor(g);
                          setAddResult(null);
                        }}
                      >
                        <Plus className="h-4 w-4" aria-hidden="true" /> Add SID
                      </Button>
                      <Tooltip content="Activate this SID group">
                        <span>
                          <Toggle
                            label={`Activate ${g.name}`}
                            labelHidden
                            checked={isActive}
                            disabled={pending || isActive}
                            onCheckedChange={(next) => {
                              if (next) activate(g.id);
                            }}
                          />
                        </span>
                      </Tooltip>
                    </div>
                  </div>
                  {open ? (
                    <ul
                      className="divide-y divide-rule border-t border-rule bg-page"
                      aria-label={`Sender ids of ${g.name}`}
                    >
                      {g.senderIds.length === 0 ? (
                        <li className="px-3 py-2 text-xs text-muted">
                          No sender ids yet. Use Add SID.
                        </li>
                      ) : null}
                      {g.senderIds.map((s) => (
                        <li
                          key={s.id}
                          className="flex items-center justify-between px-3 py-1.5 pl-10"
                        >
                          <span
                            className={`font-mono text-sm ${s.active ? "text-ink" : "text-muted line-through"}`}
                          >
                            {s.value}
                          </span>
                          <Toggle
                            label={`${s.value} ${s.active ? "on" : "off"}`}
                            labelHidden
                            checked={s.active}
                            onCheckedChange={(next) => toggle(s.id, next)}
                            disabled={pending}
                          />
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        <ErrorText error={error} />
      </section>

      <Modal open={newOpen} title="New SID Group" onClose={() => setNewOpen(false)}>
        <p className="mb-3 text-sm text-muted">
          Create a sender-ID group. It becomes the active group for this campaign.
        </p>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            createGroup();
          }}
        >
          <Field label="Group name" htmlFor={`${id}-new-name`}>
            <input
              id={`${id}-new-name`}
              className={inputClass}
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="e.g. Promo SIDs"
              required
              maxLength={120}
            />
          </Field>
          <Field
            label="Sender IDs (optional, one per line or comma-separated)"
            htmlFor={`${id}-new-sids`}
            hint="Alphanumeric, 3–11 characters each."
          >
            <textarea
              id={`${id}-new-sids`}
              className={`${inputClass} h-24 font-mono`}
              value={groupSids}
              onChange={(e) => setGroupSids(e.target.value)}
              placeholder={"MyBrand\nPromo24"}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setNewOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || groupName.trim() === ""}>
              Create group
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={addFor !== null}
        title="Add Sender IDs"
        onClose={() => {
          setAddFor(null);
          setAddResult(null);
        }}
      >
        <p className="mb-3 text-sm text-muted">
          Add sender IDs to <span className="font-medium text-ink">{addFor?.name}</span>. New SIDs
          start active.
        </p>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            addSids();
          }}
        >
          <Field
            label="Sender IDs (one per line or comma-separated)"
            htmlFor={`${id}-sids`}
            hint="Alphanumeric, 3–11 characters each."
          >
            <textarea
              id={`${id}-sids`}
              className={`${inputClass} h-32 font-mono`}
              value={sidsInput}
              onChange={(e) => setSidsInput(e.target.value)}
              placeholder={"MyBrand\nPromo24"}
            />
          </Field>
          {addResult ? <p className="text-xs text-good">{addResult}</p> : null}
          <ErrorText error={error} />
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setAddFor(null);
                setAddResult(null);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending || sidsInput.trim() === ""}>
              Add SIDs
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
