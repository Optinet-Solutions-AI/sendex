import { z } from "zod";

/**
 * Segments (D4-04): saved rule trees over contacts and their history, evaluated live.
 * This module holds the field catalogue of the spec's picker (the fields Sendex has data
 * for), the operators per field kind, the rule tree schema, validation with the spec's
 * wording ("Rule 1 (Country): missing value") and the plain-English summary. Compiling a
 * tree to SQL lives in `@sendex/db`.
 */

export const SEGMENT_FIELD_KINDS = ["enum", "text", "number", "date"] as const;
export type SegmentFieldKind = (typeof SEGMENT_FIELD_KINDS)[number];

/** Where an enum field's choices come from; the page loads them. */
export type SegmentEnumSource = "country" | "list" | "campaign" | "device" | "network";

export interface SegmentFieldDef {
  key: string;
  label: string;
  group: string;
  kind: SegmentFieldKind;
  enumSource?: SegmentEnumSource;
  /** Comes from link-click tracking: the picker shows an amber "click data" tag. */
  clickData?: boolean;
  /** Number fields: the unit shown next to the value. */
  unit?: "count" | "percent" | "eur";
}

/** The picker's groups, in its order. "(more)" groups hold the less common fields. */
export const SEGMENT_GROUPS = [
  "List",
  "Identity",
  "Engagement",
  "Recency",
  "Campaign Activity",
  "List (more)",
  "Identity (more)",
  "Engagement (more)",
  "Recency (more)",
  "Device & Network (more)",
  "Enrichment (more)",
  "Campaign Activity (more)",
] as const;

export const SEGMENT_FIELDS: readonly SegmentFieldDef[] = [
  { key: "list", label: "List", group: "List", kind: "enum", enumSource: "list" },
  { key: "country", label: "Country", group: "Identity", kind: "enum", enumSource: "country" },
  { key: "sent_count", label: "Sent Count", group: "Engagement", kind: "number", unit: "count" },
  {
    key: "clicks_count",
    label: "Clicks Count",
    group: "Engagement",
    kind: "number",
    unit: "count",
    clickData: true,
  },
  {
    key: "ctr_level",
    label: "CTR Level",
    group: "Engagement",
    kind: "number",
    unit: "percent",
    clickData: true,
  },
  { key: "last_received_sms", label: "Last Received SMS", group: "Recency", kind: "date" },
  { key: "last_clicked", label: "Last Clicked", group: "Recency", kind: "date", clickData: true },
  {
    key: "sent_in_campaign",
    label: "Sent in Campaign",
    group: "Campaign Activity",
    kind: "enum",
    enumSource: "campaign",
  },
  {
    key: "lead_in_campaign",
    label: "Lead in Campaign",
    group: "Campaign Activity",
    kind: "enum",
    enumSource: "campaign",
  },
  { key: "list_name", label: "List Name", group: "List (more)", kind: "text" },
  { key: "list_created", label: "List Created", group: "List (more)", kind: "date" },
  { key: "number_added", label: "Number Added", group: "Identity (more)", kind: "date" },
  { key: "first_name", label: "First Name", group: "Identity (more)", kind: "text" },
  { key: "last_name", label: "Last Name", group: "Identity (more)", kind: "text" },
  { key: "email", label: "Email", group: "Identity (more)", kind: "text" },
  { key: "leads", label: "Leads", group: "Engagement (more)", kind: "number", unit: "count" },
  { key: "sales", label: "Sales", group: "Engagement (more)", kind: "number", unit: "count" },
  {
    key: "cost_per_click",
    label: "Cost Per Click",
    group: "Engagement (more)",
    kind: "number",
    unit: "eur",
    clickData: true,
  },
  {
    key: "dlr_delivery_rate",
    label: "DLR - Delivery Rate (%)",
    group: "Engagement (more)",
    kind: "number",
    unit: "percent",
  },
  {
    key: "dlr_rejected",
    label: "DLR - Rejected",
    group: "Engagement (more)",
    kind: "number",
    unit: "count",
  },
  {
    key: "dlr_expired",
    label: "DLR - Expired",
    group: "Engagement (more)",
    kind: "number",
    unit: "count",
  },
  {
    key: "dlr_delivered",
    label: "DLR - Delivered",
    group: "Engagement (more)",
    kind: "number",
    unit: "count",
  },
  { key: "last_lead", label: "Last Lead", group: "Recency (more)", kind: "date" },
  { key: "last_sale", label: "Last Sale", group: "Recency (more)", kind: "date" },
  {
    key: "mobile_network",
    label: "Mobile Network",
    group: "Device & Network (more)",
    kind: "enum",
    enumSource: "network",
    clickData: true,
  },
  {
    key: "device",
    label: "Device",
    group: "Device & Network (more)",
    kind: "enum",
    enumSource: "device",
    clickData: true,
  },
  { key: "browser", label: "Browser", group: "Enrichment (more)", kind: "text", clickData: true },
  {
    key: "click_country",
    label: "Click Country",
    group: "Enrichment (more)",
    kind: "enum",
    enumSource: "country",
    clickData: true,
  },
  {
    key: "clicked_in_campaign",
    label: "Clicked in Campaign",
    group: "Campaign Activity (more)",
    kind: "enum",
    enumSource: "campaign",
    clickData: true,
  },
];

const FIELD_BY_KEY = new Map(SEGMENT_FIELDS.map((f) => [f.key, f]));

export function segmentField(key: string): SegmentFieldDef | undefined {
  return FIELD_BY_KEY.get(key);
}

export interface OperatorDef {
  value: string;
  label: string;
  /** What the value input holds: nothing, one value, a list, a number range, or a day count. */
  input: "none" | "one" | "many" | "range" | "days";
}

export const OPERATORS: Record<SegmentFieldKind, readonly OperatorDef[]> = {
  enum: [
    { value: "equals", label: "equals", input: "one" },
    { value: "not_equals", label: "not equals", input: "one" },
    { value: "in", label: "in", input: "many" },
    { value: "not_in", label: "not in", input: "many" },
  ],
  text: [
    { value: "equals", label: "equals", input: "one" },
    { value: "not_equals", label: "not equals", input: "one" },
    { value: "contains", label: "contains", input: "one" },
    { value: "not_contains", label: "does not contain", input: "one" },
    { value: "is_set", label: "is set", input: "none" },
    { value: "is_not_set", label: "is not set", input: "none" },
  ],
  number: [
    { value: "equals", label: "=", input: "one" },
    { value: "not_equals", label: "≠", input: "one" },
    { value: "gt", label: ">", input: "one" },
    { value: "gte", label: "≥", input: "one" },
    { value: "lt", label: "<", input: "one" },
    { value: "lte", label: "≤", input: "one" },
    { value: "between", label: "between", input: "range" },
  ],
  date: [
    { value: "within_days", label: "in the last … days", input: "days" },
    { value: "not_within_days", label: "not in the last … days", input: "days" },
    { value: "before", label: "before", input: "one" },
    { value: "after", label: "after", input: "one" },
    { value: "is_set", label: "is set", input: "none" },
    { value: "is_not_set", label: "is not set", input: "none" },
  ],
};

export function operatorsFor(kind: SegmentFieldKind): readonly OperatorDef[] {
  return OPERATORS[kind];
}

export function operatorDef(kind: SegmentFieldKind, operator: string): OperatorDef | undefined {
  return OPERATORS[kind].find((o) => o.value === operator);
}

// ---------------------------------------------------------------------------
// The rule tree
// ---------------------------------------------------------------------------

export interface SegmentRule {
  /** Client-side identity for the builder rows. */
  id: string;
  field: string;
  operator: string;
  value?: unknown;
}

export interface SegmentGroup {
  id: string;
  op: "and" | "or";
  rules: SegmentNode[];
}

export type SegmentNode = SegmentRule | SegmentGroup;

export function isSegmentGroup(node: SegmentNode): node is SegmentGroup {
  return "rules" in node;
}

const segmentRuleSchema = z.object({
  id: z.string().min(1).max(64),
  field: z.string().min(1).max(64),
  operator: z.string().min(1).max(32),
  value: z.unknown().optional(),
});

export const segmentGroupSchema: z.ZodType<SegmentGroup> = z.lazy(() =>
  z.object({
    id: z.string().min(1).max(64),
    op: z.enum(["and", "or"]),
    rules: z.array(z.union([segmentRuleSchema, segmentGroupSchema])).max(200),
  }),
);

export const segmentSchema = z.object({
  name: z.string().trim().min(1, "Give the segment a name").max(120),
  definition: segmentGroupSchema,
  isTemplate: z.boolean().default(false),
  globalExclude: z.boolean().default(false),
});
export type SegmentInput = z.infer<typeof segmentSchema>;

let counter = 0;
/** Ids for new rows; the builder is the only caller, so a counter plus time is enough. */
export function newNodeId(prefix = "r"): string {
  counter += 1;
  return `${prefix}${Date.now().toString(36)}${counter}`;
}

export function emptySegmentGroup(): SegmentGroup {
  return { id: newNodeId("g"), op: "and", rules: [] };
}

export function newSegmentRule(field = "country"): SegmentRule {
  const def = segmentField(field);
  const first = def ? OPERATORS[def.kind][0] : undefined;
  return { id: newNodeId("r"), field, operator: first?.value ?? "equals" };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface SegmentProblem {
  /** 1-based rule number, counted depth-first through the whole tree. */
  rule: number;
  ruleId: string;
  field: string;
  message: string;
}

function hasOne(value: unknown): boolean {
  if (typeof value === "string") return value.trim() !== "";
  if (typeof value === "number") return Number.isFinite(value);
  return false;
}

function isDay(value: unknown): boolean {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/** Every problem in the tree, worded as the spec's amber banner lines. */
export function validateSegment(group: SegmentGroup): SegmentProblem[] {
  const problems: SegmentProblem[] = [];
  let n = 0;
  const walk = (g: SegmentGroup) => {
    for (const node of g.rules) {
      if (isSegmentGroup(node)) {
        walk(node);
        continue;
      }
      n += 1;
      const def = segmentField(node.field);
      const label = def?.label ?? node.field;
      const push = (message: string) =>
        problems.push({
          rule: n,
          ruleId: node.id,
          field: label,
          message: `Rule ${n} (${label}): ${message}`,
        });
      if (!def) {
        push("unknown field");
        continue;
      }
      const op = operatorDef(def.kind, node.operator);
      if (!op) {
        push("missing operator");
        continue;
      }
      const v = node.value;
      switch (op.input) {
        case "none":
          break;
        case "one":
          if (def.kind === "number") {
            if (typeof v !== "number" || !Number.isFinite(v)) push("missing value");
          } else if (def.kind === "date") {
            if (!isDay(v)) push("missing date");
          } else if (!hasOne(v)) push("missing value");
          break;
        case "many":
          if (!Array.isArray(v) || v.length === 0 || !v.every(hasOne))
            push("pick at least one value");
          break;
        case "range":
          if (
            !Array.isArray(v) ||
            v.length !== 2 ||
            !v.every((x) => typeof x === "number" && Number.isFinite(x)) ||
            Number(v[0]) > Number(v[1])
          )
            push("needs a low and a high value");
          break;
        case "days":
          if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 3_650)
            push("needs a number of days (1 to 3650)");
          break;
      }
    }
  };
  walk(group);
  return problems;
}

/** How many rules the tree holds. */
export function countRules(group: SegmentGroup): number {
  return group.rules.reduce((n, node) => n + (isSegmentGroup(node) ? countRules(node) : 1), 0);
}

// ---------------------------------------------------------------------------
// Plain-English summary
// ---------------------------------------------------------------------------

export interface SegmentLookups {
  /** id → name, for list and campaign values. */
  lists?: ReadonlyMap<string, string>;
  campaigns?: ReadonlyMap<string, string>;
}

function describeValue(def: SegmentFieldDef, value: unknown, lookups: SegmentLookups): string {
  const name = (v: unknown): string => {
    const s = String(v);
    if (def.enumSource === "list") return lookups.lists?.get(s) ?? `list ${s.slice(0, 8)}`;
    if (def.enumSource === "campaign")
      return lookups.campaigns?.get(s) ?? `campaign ${s.slice(0, 8)}`;
    return s;
  };
  if (Array.isArray(value)) return value.map(name).join(", ");
  if (value === undefined || value === null) return "";
  if (def.unit === "percent") return `${String(value)}%`;
  if (def.unit === "eur") return `€${String(value)}`;
  return name(value);
}

/** "Country equals ES and Clicks Count > 0, excluding (Last Clicked not in the last 30 days)". */
export function describeSegment(group: SegmentGroup, lookups: SegmentLookups = {}): string {
  const parts = group.rules.map((node) => {
    if (isSegmentGroup(node)) return `(${describeSegment(node, lookups)})`;
    const def = segmentField(node.field);
    if (!def) return node.field;
    const op = operatorDef(def.kind, node.operator);
    const opLabel = op?.label ?? node.operator;
    if (!op || op.input === "none") return `${def.label} ${opLabel}`;
    if (op.input === "days")
      return `${def.label} ${opLabel.replace("…", String(node.value ?? "?"))}`;
    if (op.input === "range" && Array.isArray(node.value)) {
      return `${def.label} between ${String(node.value[0])} and ${String(node.value[1])}`;
    }
    return `${def.label} ${opLabel} ${describeValue(def, node.value, lookups)}`.trim();
  });
  if (parts.length === 0) return "No rules";
  return parts.join(group.op === "and" ? " and " : " or ");
}

// ---------------------------------------------------------------------------
// AI rule generator prompt
// ---------------------------------------------------------------------------

/** The catalogue the AI generator gets, with every operator per field. */
export function ruleGeneratorCatalogue(): string {
  return SEGMENT_FIELDS.map((f) => {
    const ops = OPERATORS[f.kind].map((o) => o.value).join("|");
    const value =
      f.kind === "enum"
        ? `${f.enumSource} value or array of values`
        : f.kind === "number"
          ? `number${f.unit === "percent" ? " (percent)" : f.unit === "eur" ? " (EUR)" : ""}`
          : f.kind === "date"
            ? "YYYY-MM-DD for before/after, integer days for within_days"
            : "string";
    return `- ${f.key} (${f.label}, ${f.group}): operators ${ops}; value: ${value}`;
  }).join("\n");
}
