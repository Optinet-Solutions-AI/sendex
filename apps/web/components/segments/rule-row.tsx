"use client";

import {
  operatorDef,
  operatorsFor,
  type SegmentFieldDef,
  type SegmentRule,
  segmentField,
} from "@sendex/core";
import { IconButton } from "@sendex/ui";
import { X } from "lucide-react";
import { inputClass } from "../campaigns/ui";
import { FieldPicker } from "./field-picker";
import type { SegmentChoices } from "./types";

function choicesFor(def: SegmentFieldDef, choices: SegmentChoices) {
  switch (def.enumSource) {
    case "country":
      return choices.countries;
    case "list":
      return choices.lists;
    case "campaign":
      return choices.campaigns;
    case "device":
      return choices.devices;
    case "network":
      return choices.networks;
    default:
      return [];
  }
}

/** One rule of the builder: field picker, operator dropdown, value input and ×. */
export function RuleRow({
  rule,
  number,
  invalid,
  choices,
  onChange,
  onRemove,
}: {
  rule: SegmentRule;
  number: number;
  invalid: boolean;
  choices: SegmentChoices;
  onChange: (next: SegmentRule) => void;
  onRemove: () => void;
}) {
  const def = segmentField(rule.field);
  const kind = def?.kind ?? "text";
  const op = operatorDef(kind, rule.operator);
  const options = def ? choicesFor(def, choices) : [];

  function setField(field: string) {
    const nextDef = segmentField(field);
    const first = nextDef ? operatorsFor(nextDef.kind)[0] : undefined;
    onChange({ id: rule.id, field, operator: first?.value ?? "equals" });
  }

  function setOperator(operator: string) {
    const nextOp = operatorDef(kind, operator);
    const keep = nextOp && op && nextOp.input === op.input;
    onChange({ id: rule.id, field: rule.field, operator, ...(keep ? { value: rule.value } : {}) });
  }

  const set = (value: unknown) => onChange({ ...rule, value });

  let valueInput: React.ReactNode = null;
  if (!op || op.input === "none") {
    valueInput = null;
  } else if (op.input === "days") {
    valueInput = (
      <span className="inline-flex items-center gap-1 text-sm text-muted">
        <input
          type="number"
          min={1}
          max={3650}
          className={`${inputClass} w-24`}
          value={typeof rule.value === "number" ? rule.value : ""}
          onChange={(e) => set(e.target.value === "" ? undefined : Number(e.target.value))}
          aria-label={`Rule ${number} days`}
          placeholder="days"
        />
        days
      </span>
    );
  } else if (op.input === "range") {
    const [lo, hi] = Array.isArray(rule.value) ? rule.value : [undefined, undefined];
    valueInput = (
      <span className="inline-flex items-center gap-1 text-sm text-muted">
        <input
          type="number"
          className={`${inputClass} w-24`}
          value={typeof lo === "number" ? lo : ""}
          onChange={(e) => set([e.target.value === "" ? undefined : Number(e.target.value), hi])}
          aria-label={`Rule ${number} from`}
        />
        and
        <input
          type="number"
          className={`${inputClass} w-24`}
          value={typeof hi === "number" ? hi : ""}
          onChange={(e) => set([lo, e.target.value === "" ? undefined : Number(e.target.value)])}
          aria-label={`Rule ${number} to`}
        />
      </span>
    );
  } else if (kind === "enum") {
    if (op.input === "many") {
      const selected = Array.isArray(rule.value) ? rule.value.map(String) : [];
      valueInput = (
        <select
          multiple
          className={`${inputClass} min-h-9 w-56`}
          value={selected}
          onChange={(e) => set(Array.from(e.target.selectedOptions).map((o) => o.value))}
          aria-label={`Rule ${number} values`}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    } else {
      valueInput = (
        <select
          className={`${inputClass} w-56`}
          value={typeof rule.value === "string" ? rule.value : ""}
          onChange={(e) => set(e.target.value === "" ? undefined : e.target.value)}
          aria-label={`Rule ${number} value`}
        >
          <option value="">Select…</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    }
  } else if (kind === "number") {
    valueInput = (
      <span className="inline-flex items-center gap-1 text-sm text-muted">
        <input
          type="number"
          step="any"
          className={`${inputClass} w-28`}
          value={typeof rule.value === "number" ? rule.value : ""}
          onChange={(e) => set(e.target.value === "" ? undefined : Number(e.target.value))}
          aria-label={`Rule ${number} value`}
        />
        {def?.unit === "percent" ? "%" : def?.unit === "eur" ? "€" : null}
      </span>
    );
  } else if (kind === "date") {
    valueInput = (
      <input
        type="date"
        className={`${inputClass} w-44`}
        value={typeof rule.value === "string" ? rule.value : ""}
        onChange={(e) => set(e.target.value || undefined)}
        aria-label={`Rule ${number} date`}
      />
    );
  } else {
    valueInput = (
      <input
        type="text"
        className={`${inputClass} w-56`}
        value={typeof rule.value === "string" ? rule.value : ""}
        onChange={(e) => set(e.target.value)}
        aria-label={`Rule ${number} value`}
        placeholder="value"
      />
    );
  }

  return (
    <div
      className={`flex flex-wrap items-center gap-2 rounded-md border p-2 ${
        invalid ? "border-signal bg-red-50" : "border-rule bg-surface"
      }`}
      data-testid="segment-rule"
      data-invalid={invalid ? "true" : "false"}
    >
      <span className="w-6 font-mono text-xs text-muted">{number}</span>
      <FieldPicker value={rule.field} onChange={setField} />
      <select
        className={`${inputClass} w-44`}
        value={rule.operator}
        onChange={(e) => setOperator(e.target.value)}
        aria-label={`Rule ${number} operator`}
      >
        {operatorsFor(kind).map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {valueInput}
      <IconButton
        label={`Remove rule ${number}`}
        tooltip="Remove rule"
        icon={<X />}
        tone="danger"
        className="ml-auto"
        onClick={onRemove}
      />
    </div>
  );
}
