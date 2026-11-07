import { describe, expect, it } from "vitest";
import {
  countRules,
  describeSegment,
  emptySegmentGroup,
  newSegmentRule,
  operatorsFor,
  ruleGeneratorCatalogue,
  SEGMENT_FIELDS,
  SEGMENT_GROUPS,
  type SegmentGroup,
  segmentField,
  segmentSchema,
  validateSegment,
} from "./segments.js";

describe("field catalogue", () => {
  it("every field sits in a known group and enum fields name their source", () => {
    for (const f of SEGMENT_FIELDS) {
      expect(SEGMENT_GROUPS).toContain(f.group);
      if (f.kind === "enum") expect(f.enumSource).toBeDefined();
    }
    expect(segmentField("country")).toMatchObject({ kind: "enum", enumSource: "country" });
    expect(segmentField("clicks_count")?.clickData).toBe(true);
    expect(operatorsFor("date").map((o) => o.value)).toContain("within_days");
  });
});

const tree: SegmentGroup = {
  id: "g1",
  op: "and",
  rules: [
    { id: "r1", field: "country", operator: "equals", value: "ES" },
    { id: "r2", field: "clicks_count", operator: "gt", value: 0 },
    {
      id: "g2",
      op: "or",
      rules: [
        { id: "r3", field: "last_clicked", operator: "within_days", value: 30 },
        { id: "r4", field: "list", operator: "in", value: ["list-a"] },
      ],
    },
  ],
};

describe("validateSegment", () => {
  it("accepts a complete tree", () => {
    expect(validateSegment(tree)).toEqual([]);
    expect(countRules(tree)).toBe(4);
    expect(segmentSchema.parse({ name: " ES clickers ", definition: tree })).toMatchObject({
      name: "ES clickers",
      isTemplate: false,
      globalExclude: false,
    });
  });

  it("words problems like the spec's banner, numbering rules depth-first", () => {
    const broken: SegmentGroup = {
      id: "g",
      op: "and",
      rules: [
        { id: "a", field: "country", operator: "equals" },
        {
          id: "g2",
          op: "or",
          rules: [
            { id: "b", field: "sent_count", operator: "between", value: [5, 1] },
            { id: "c", field: "last_clicked", operator: "within_days", value: 0 },
          ],
        },
        { id: "d", field: "nope", operator: "equals", value: "x" },
        { id: "e", field: "list", operator: "in", value: [] },
      ],
    };
    expect(validateSegment(broken).map((p) => p.message)).toEqual([
      "Rule 1 (Country): missing value",
      "Rule 2 (Sent Count): needs a low and a high value",
      "Rule 3 (Last Clicked): needs a number of days (1 to 3650)",
      "Rule 4 (nope): unknown field",
      "Rule 5 (List): pick at least one value",
    ]);
  });

  it("a fresh rule starts valid-shaped with the field's first operator", () => {
    const rule = newSegmentRule("sent_count");
    expect(rule.operator).toBe("equals");
    expect(emptySegmentGroup()).toMatchObject({ op: "and", rules: [] });
  });
});

describe("describeSegment", () => {
  it("reads as plain English with list names looked up", () => {
    const text = describeSegment(tree, { lists: new Map([["list-a", "Roy Boy_ES_Batch2"]]) });
    expect(text).toBe(
      "Country equals ES and Clicks Count > 0 and (Last Clicked in the last 30 days or List in Roy Boy_ES_Batch2)",
    );
    expect(describeSegment(emptySegmentGroup())).toBe("No rules");
  });
});

describe("ruleGeneratorCatalogue", () => {
  it("lists every field with its operators", () => {
    const text = ruleGeneratorCatalogue();
    expect(text).toContain("- country (Country, Identity): operators equals|not_equals|in|not_in");
    expect(text.split("\n")).toHaveLength(SEGMENT_FIELDS.length);
  });
});
