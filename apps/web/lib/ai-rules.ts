import {
  newNodeId,
  ruleGeneratorCatalogue,
  type SegmentGroup,
  segmentGroupSchema,
  validateSegment,
} from "@sendex/core";

/**
 * The AI Rule Generator of the segment builder: plain English in, a rule tree out, through
 * the Claude API. Server-only (it holds the key). Without `ANTHROPIC_API_KEY` the generator
 * reports that it is not configured; nothing else in the builder depends on it.
 */

const MODEL = "claude-sonnet-5-5";
const API_URL = "https://api.anthropic.com/v1/messages";

export interface GenerateRulesInput {
  prompt: string;
  /** The rules already in the builder, to add to or amend. */
  current: SegmentGroup;
  /** Names the model may use for list and campaign values. */
  lists: ReadonlyArray<{ id: string; name: string }>;
  campaigns: ReadonlyArray<{ id: string; name: string }>;
  fetchImpl?: typeof fetch;
  apiKey?: string | undefined;
}

export type GenerateRulesResult =
  | { ok: true; definition: SegmentGroup; note: string }
  | { ok: false; error: string };

function systemPrompt(input: GenerateRulesInput): string {
  const lists = input.lists.map((l) => `${l.id} = ${l.name}`).join("\n") || "(none)";
  const campaigns = input.campaigns.map((c) => `${c.id} = ${c.name}`).join("\n") || "(none)";
  return `You turn a marketer's plain-English audience description into a Sendex segment rule tree.
Answer with JSON only, no prose, of the shape:
{"definition": {"id": "g1", "op": "and" | "or", "rules": [ {"id": "r1", "field": "<key>", "operator": "<operator>", "value": <value>} | <nested group> ]}, "note": "<one sentence on what you did>"}

Fields and their operators:
${ruleGeneratorCatalogue()}

Enum values: country is an ISO-2 code (ES, GB, DE…); device is one of mobile, desktop, tablet, bot; list and campaign values are ids from these tables:
Lists:
${lists}
Campaigns:
${campaigns}

Rules: use only the fields and operators listed. Dates: "within_days" takes an integer number of days, "before"/"after" take YYYY-MM-DD. If the user says "add" or "also", keep the current rules and add to them; if they say "change" or "instead", amend. Keep ids of rules you keep. Never invent list or campaign ids that are not in the tables.`;
}

function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no JSON in the answer");
  return JSON.parse(text.slice(start, end + 1));
}

/** Give every group and rule an id before validation: the model often leaves them blank. */
function withIds(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return raw;
  const node = raw as Record<string, unknown>;
  const isGroup = Array.isArray(node.rules);
  const id =
    typeof node.id === "string" && node.id !== "" ? node.id : newNodeId(isGroup ? "g" : "r");
  if (!isGroup) return { ...node, id };
  return { ...node, id, rules: (node.rules as unknown[]).map(withIds) };
}

export async function generateRules(input: GenerateRulesInput): Promise<GenerateRulesResult> {
  const apiKey = (input.apiKey ?? process.env.ANTHROPIC_API_KEY)?.trim();
  if (!apiKey) {
    return {
      ok: false,
      error:
        "The AI rule generator needs ANTHROPIC_API_KEY on the web app. Add rules by hand for now.",
    };
  }
  const doFetch = input.fetchImpl ?? fetch;
  const response = await doFetch(API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1_500,
      system: systemPrompt(input),
      messages: [
        {
          role: "user",
          content: `Current rules (JSON): ${JSON.stringify(input.current)}\n\nRequest: ${input.prompt}`,
        },
      ],
    }),
  });
  if (!response.ok) {
    return { ok: false, error: `The AI service answered ${response.status}` };
  }
  const body = (await response.json()) as { content?: Array<{ type: string; text?: string }> };
  const text = (body.content ?? [])
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("\n");
  try {
    const parsed = extractJson(text) as { definition?: unknown; note?: unknown };
    const definition: SegmentGroup = segmentGroupSchema.parse(withIds(parsed.definition));
    const problems = validateSegment(definition);
    if (problems.length > 0) {
      return {
        ok: false,
        error: `The generated rules are incomplete: ${problems[0]?.message ?? ""}`,
      };
    }
    return {
      ok: true,
      definition,
      note: typeof parsed.note === "string" ? parsed.note : "Rules generated.",
    };
  } catch (error) {
    return {
      ok: false,
      error: `Could not read the AI answer: ${error instanceof Error ? error.message : "unknown error"}`,
    };
  }
}
