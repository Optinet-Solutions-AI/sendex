import { describe, expect, it } from "vitest";
import { generateRules } from "./ai-rules";

const current = { id: "g1", op: "and" as const, rules: [] };

describe("generateRules", () => {
  it("says so when no key is configured", async () => {
    const result = await generateRules({
      prompt: "UK clickers",
      current,
      lists: [],
      campaigns: [],
      apiKey: "",
      fetchImpl: async () => {
        throw new Error("must not be called");
      },
    });
    expect(result).toMatchObject({ ok: false });
    expect(result.ok ? "" : result.error).toContain("ANTHROPIC_API_KEY");
  });

  it("parses the model's JSON into a validated tree with ids", async () => {
    const answer = {
      content: [
        {
          type: "text",
          text: 'Here you go: {"definition": {"id": "", "op": "and", "rules": [{"id": "", "field": "country", "operator": "equals", "value": "GB"}, {"id": "", "field": "last_clicked", "operator": "within_days", "value": 30}]}, "note": "UK contacts that clicked in the last 30 days."}',
        },
      ],
    };
    const result = await generateRules({
      prompt: "UK clickers from the last 30 days",
      current,
      lists: [],
      campaigns: [],
      apiKey: "sk-test",
      fetchImpl: async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        expect(body.model).toBe("claude-sonnet-5-5");
        expect(body.system).toContain("- country (Country, Identity)");
        return new Response(JSON.stringify(answer), { status: 200 });
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.definition.rules).toHaveLength(2);
    expect(result.definition.rules.every((r) => "id" in r && r.id.length > 0)).toBe(true);
    expect(result.note).toContain("UK contacts");
  });

  it("refuses an incomplete answer and reports API failures", async () => {
    const bad = await generateRules({
      prompt: "x",
      current,
      lists: [],
      campaigns: [],
      apiKey: "sk-test",
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            content: [
              {
                type: "text",
                text: '{"definition": {"id":"g","op":"and","rules":[{"id":"r","field":"country","operator":"equals"}]}}',
              },
            ],
          }),
          { status: 200 },
        ),
    });
    expect(bad).toMatchObject({ ok: false });
    expect(bad.ok ? "" : bad.error).toContain("Rule 1 (Country): missing value");
    const down = await generateRules({
      prompt: "x",
      current,
      lists: [],
      campaigns: [],
      apiKey: "sk-test",
      fetchImpl: async () => new Response("nope", { status: 529 }),
    });
    expect(down).toEqual({ ok: false, error: "The AI service answered 529" });
  });
});
