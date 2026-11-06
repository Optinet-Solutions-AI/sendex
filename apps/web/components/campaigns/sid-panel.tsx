"use client";

import { useId, useState, useTransition } from "react";
import {
  addSenderIdsAction,
  createSidGroupAction,
  setCampaignSidGroupAction,
  toggleSenderIdAction,
} from "../../app/(dashboard)/campaigns/actions";
import type { CampaignView, SidGroupView } from "./types";
import { Button, ErrorText, Field, inputClass, Modal, Panel, Toggle } from "./ui";

/** Sender id group select for the campaign country, with "New group" and "Add SIDs" dialogs. */
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
  const [addOpen, setAddOpen] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [sidsInput, setSidsInput] = useState("");
  const [addResult, setAddResult] = useState<string | null>(null);
  const current = campaign.sidGroup;

  function pickGroup(groupId: string) {
    if (!groupId) return;
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
      setGroupName("");
      setNewOpen(false);
      onChanged();
    });
  }

  function addSids() {
    if (!current) return;
    setError(null);
    start(async () => {
      const result = await addSenderIdsAction({
        campaignId: campaign.id,
        groupId: current.id,
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

  return (
    <Panel
      title="SIDs"
      testId="sid-panel"
      action={
        <div className="flex gap-2">
          <Button size="sm" onClick={() => setNewOpen(true)}>
            New group
          </Button>
          <Button size="sm" onClick={() => setAddOpen(true)} disabled={!current}>
            Add SIDs
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <Field label={`Sender id group (${campaign.country})`} htmlFor={`${id}-group`}>
          <select
            id={`${id}-group`}
            className={inputClass}
            value={current?.id ?? ""}
            onChange={(e) => pickGroup(e.target.value)}
            disabled={pending}
            data-testid="sid-group-select"
          >
            <option value="">Pick a group</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name} ({g.activeCount} active of {g.senderIds.length})
              </option>
            ))}
          </select>
        </Field>
        {current ? (
          <ul className="flex flex-wrap gap-1.5" aria-label="Sender ids">
            {current.senderIds.map((s) => (
              <li
                key={s.id}
                className={`flex items-center gap-1.5 rounded border px-2 py-0.5 font-mono text-xs ${
                  s.active
                    ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                    : "border-neutral-200 bg-neutral-50 text-neutral-400 line-through"
                }`}
              >
                {s.value}
                <Toggle
                  label={`${s.value} ${s.active ? "on" : "off"}`}
                  checked={s.active}
                  onChange={(next) => toggle(s.id, next)}
                  disabled={pending}
                />
              </li>
            ))}
            {current.senderIds.length === 0 ? (
              <li className="text-xs text-neutral-500">No sender ids yet. Use "Add SIDs".</li>
            ) : null}
          </ul>
        ) : (
          <p className="text-xs text-neutral-500">
            Pick a group or create one; the campaign rotates through its active sender ids.
          </p>
        )}
        <ErrorText error={error} />
      </div>

      <Modal open={newOpen} title="New sender id group" onClose={() => setNewOpen(false)}>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            createGroup();
          }}
        >
          <Field label="Name" htmlFor={`${id}-new-name`} hint={`Country: ${campaign.country}`}>
            <input
              id={`${id}-new-name`}
              className={inputClass}
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              required
              maxLength={120}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setNewOpen(false)}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={pending || groupName.trim() === ""}>
              Create group
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={addOpen}
        title={`Add SIDs to ${current?.name ?? "group"}`}
        onClose={() => {
          setAddOpen(false);
          setAddResult(null);
        }}
      >
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            addSids();
          }}
        >
          <Field
            label="Sender ids"
            htmlFor={`${id}-sids`}
            hint="One per line or comma separated, 3 to 11 letters or digits. Duplicates are skipped."
          >
            <textarea
              id={`${id}-sids`}
              className={`${inputClass} h-32 font-mono`}
              value={sidsInput}
              onChange={(e) => setSidsInput(e.target.value)}
              placeholder={"LUCKY777\nBONUS777"}
            />
          </Field>
          {addResult ? <p className="text-xs text-emerald-700">{addResult}</p> : null}
          <ErrorText error={error} />
          <div className="flex justify-end gap-2">
            <Button
              onClick={() => {
                setAddOpen(false);
                setAddResult(null);
              }}
            >
              Close
            </Button>
            <Button type="submit" variant="primary" disabled={pending || sidsInput.trim() === ""}>
              Add
            </Button>
          </div>
        </form>
      </Modal>
    </Panel>
  );
}
