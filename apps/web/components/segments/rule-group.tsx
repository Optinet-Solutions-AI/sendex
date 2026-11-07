"use client";

import {
  emptySegmentGroup,
  isSegmentGroup,
  newSegmentRule,
  type SegmentGroup,
  type SegmentNode,
} from "@sendex/core";
import { Button, SegmentedControl } from "@sendex/ui";
import { Plus, SquarePlus, Trash2 } from "lucide-react";
import { RuleRow } from "./rule-row";
import type { SegmentChoices } from "./types";

/** Depth-first rule numbering: each rule's number, keyed by rule id. */
export function numberRules(group: SegmentGroup, start = 1): Map<string, number> {
  const numbers = new Map<string, number>();
  let n = start;
  const walk = (g: SegmentGroup) => {
    for (const node of g.rules) {
      if (isSegmentGroup(node)) walk(node);
      else numbers.set(node.id, n++);
    }
  };
  walk(group);
  return numbers;
}

/**
 * The Rules card body: an AND | OR toggle, one row per rule, Add Rule and Add Group; nested
 * groups are indented with a left border, with their own toggle and "Remove group".
 */
export function RuleGroup({
  group,
  numbers,
  invalidIds,
  choices,
  onChange,
  onRemove,
  onRuleRemoved,
  depth = 0,
}: {
  group: SegmentGroup;
  numbers: Map<string, number>;
  invalidIds: ReadonlySet<string>;
  choices: SegmentChoices;
  onChange: (next: SegmentGroup) => void;
  onRemove?: () => void;
  onRuleRemoved: () => void;
  depth?: number;
}) {
  const replace = (index: number, node: SegmentNode) =>
    onChange({ ...group, rules: group.rules.map((r, i) => (i === index ? node : r)) });
  const remove = (index: number) =>
    onChange({ ...group, rules: group.rules.filter((_, i) => i !== index) });

  return (
    <div
      className={depth > 0 ? "ml-3 space-y-2 border-l-2 border-rule pl-3" : "space-y-2"}
      data-testid="segment-group"
      data-depth={depth}
    >
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl
          label={depth === 0 ? "Match" : "Match in group"}
          size="sm"
          value={group.op}
          options={[
            { value: "and", label: "AND" },
            { value: "or", label: "OR" },
          ]}
          onChange={(op) => onChange({ ...group, op })}
        />
        {onRemove ? (
          <Button variant="ghost" size="sm" onClick={onRemove} className="text-signal">
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Remove group
          </Button>
        ) : null}
      </div>
      {group.rules.map((node, index) =>
        isSegmentGroup(node) ? (
          <RuleGroup
            key={node.id}
            group={node}
            numbers={numbers}
            invalidIds={invalidIds}
            choices={choices}
            depth={depth + 1}
            onChange={(next) => replace(index, next)}
            onRemove={() => remove(index)}
            onRuleRemoved={onRuleRemoved}
          />
        ) : (
          <RuleRow
            key={node.id}
            rule={node}
            number={numbers.get(node.id) ?? 0}
            invalid={invalidIds.has(node.id)}
            choices={choices}
            onChange={(next) => replace(index, next)}
            onRemove={() => {
              remove(index);
              onRuleRemoved();
            }}
          />
        ),
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onChange({ ...group, rules: [...group.rules, newSegmentRule()] })}
          data-testid={depth === 0 ? "add-rule" : undefined}
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add Rule
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            onChange({
              ...group,
              rules: [...group.rules, { ...emptySegmentGroup(), rules: [newSegmentRule()] }],
            })
          }
          data-testid={depth === 0 ? "add-group" : undefined}
        >
          <SquarePlus className="h-3.5 w-3.5" aria-hidden="true" /> Add Group
        </Button>
      </div>
    </div>
  );
}
