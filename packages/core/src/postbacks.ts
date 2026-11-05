/**
 * Conversion postbacks: the parameters a brand's tracker sends back when a contact who
 * clicked a tracked link registers (lead) or pays (sale), the HMAC signature that proves
 * the call came from the brand, and the deterministic event key that makes a re-sent
 * postback a duplicate instead of a second conversion. Pure functions shared by the
 * worker (verifies and ingests), the web app (shows the URL to configure) and the docs.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const POSTBACK_TYPES = ["lead", "sale"] as const;
export type PostbackType = (typeof POSTBACK_TYPES)[number];

/** Names a tracker may use for each type; keys are compared lower-case. */
export const POSTBACK_TYPE_ALIASES: Readonly<Record<string, PostbackType>> = {
  lead: "lead",
  registration: "lead",
  reg: "lead",
  signup: "lead",
  sale: "sale",
  deposit: "sale",
  ftd: "sale",
  purchase: "sale",
};

export const postbackTypeSchema = z
  .string()
  .transform((value, ctx) => {
    const type = POSTBACK_TYPE_ALIASES[value.trim().toLowerCase()];
    if (type === undefined) {
      ctx.addIssue({
        code: "custom",
        message: `type must be one of ${Object.keys(POSTBACK_TYPE_ALIASES).join(", ")}`,
      });
      return z.NEVER;
    }
    return type;
  })
  .pipe(z.enum(POSTBACK_TYPES));

/** The value substituted for `{{dynamic}}` in the tracked link: a uuid or similar token. */
export const dynamicIdSchema = z
  .string()
  .trim()
  .min(1, "dynamic_id is required")
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/, "dynamic_id may contain letters, digits, '-' and '_' only");

export const MICRO = 1_000_000;

const DECIMAL = /^(\d+)(?:\.(\d{1,6}))?$/;

/**
 * A money amount from a tracker ("12.50", "1,5" or 12.5) as integer micro-EUR. Decimal
 * strings are parsed digit by digit so no binary float rounding creeps in; numbers go
 * through their shortest decimal representation for the same reason.
 */
export function parsePostbackValue(value: string | number): number {
  const text = typeof value === "number" ? String(value) : value.trim().replace(",", ".");
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new RangeError("value must be a finite number");
  }
  const match = DECIMAL.exec(text);
  if (match === null) {
    throw new RangeError(
      `value must be a non-negative decimal with up to six places, got "${text}"`,
    );
  }
  const whole = match[1] ?? "0";
  const fraction = (match[2] ?? "").padEnd(6, "0");
  const micro = Number(whole) * MICRO + Number(fraction);
  if (!Number.isSafeInteger(micro)) throw new RangeError("value is too large");
  return micro;
}

export const postbackValueSchema = z.union([z.string(), z.number()]).transform((value, ctx) => {
  try {
    return parsePostbackValue(value);
  } catch (error) {
    ctx.addIssue({
      code: "custom",
      message: error instanceof Error ? error.message : "invalid value",
    });
    return z.NEVER;
  }
});

/** An optional client-side event id; combined with the dynamic id into the event key. */
export const clientEventKeySchema = z.string().trim().min(1).max(200);

/** Raw query parameters as the request carried them, every value as a string. */
export type PostbackParams = Record<string, string>;

/** A postback after validation; `params` keeps every parameter received except `sig`. */
export interface IncomingPostback {
  type: PostbackType;
  dynamicId: string;
  /** Sale (or lead) value in micro-EUR, when the tracker sent one. */
  valueMicro?: number;
  clientEventKey?: string;
  params: PostbackParams;
}

/** `sig` is the signature itself; it is never part of what is signed or stored. */
export const SIGNATURE_PARAM = "sig";

const scalar = z.union([z.string(), z.number(), z.boolean()]);

const incomingPostbackShape = z.looseObject({
  type: postbackTypeSchema,
  dynamic_id: dynamicIdSchema,
  value: postbackValueSchema.optional(),
  event_key: clientEventKeySchema.optional(),
});

/**
 * Validate the parameters of a postback request. Unknown parameters are kept (the brand
 * may send sub ids and the like), stringified, and stored with the event for the log page.
 */
export type PostbackParseResult =
  | { success: true; data: IncomingPostback }
  | { success: false; error: z.ZodError };

export function parseIncomingPostback(raw: Record<string, unknown>): PostbackParseResult {
  const parsed = incomingPostbackShape.safeParse(raw);
  if (!parsed.success) return { success: false, error: parsed.error };
  const params: PostbackParams = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key === SIGNATURE_PARAM) continue;
    const asScalar = scalar.safeParse(value);
    if (!asScalar.success) continue;
    params[key] = String(asScalar.data);
  }
  const data: IncomingPostback = {
    type: parsed.data.type,
    dynamicId: parsed.data.dynamic_id,
    params,
  };
  if (parsed.data.value !== undefined) data.valueMicro = parsed.data.value;
  if (parsed.data.event_key !== undefined) data.clientEventKey = parsed.data.event_key;
  return { success: true, data };
}

// ---------------------------------------------------------------------------
// Signature
// ---------------------------------------------------------------------------

/**
 * What is signed: every parameter except `sig`, sorted by name, `name=value` with both
 * sides percent-encoded (`encodeURIComponent`), joined by `&`.
 */
export function canonicalPostbackQuery(params: PostbackParams): string {
  return Object.keys(params)
    .filter((key) => key !== SIGNATURE_PARAM)
    .sort()
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key] ?? "")}`)
    .join("&");
}

/** Lower-case hex HMAC-SHA256 of the canonical query under the organisation's secret. */
export function signPostbackQuery(params: PostbackParams, secret: string): string {
  return createHmac("sha256", secret).update(canonicalPostbackQuery(params)).digest("hex");
}

const HEX_SIGNATURE = /^[0-9a-fA-F]{64}$/;

/** Constant-time check of `sig` against the expected signature; false for anything malformed. */
export function verifyPostbackSignature(
  params: PostbackParams,
  sig: string | undefined,
  secret: string,
): boolean {
  if (secret === "" || sig === undefined || !HEX_SIGNATURE.test(sig)) return false;
  const expected = Buffer.from(signPostbackQuery(params, secret), "hex");
  const given = Buffer.from(sig.toLowerCase(), "hex");
  return expected.length === given.length && timingSafeEqual(expected, given);
}

const TEMPLATE_PLACEHOLDER = /%7B%7B([A-Za-z0-9_]+)%7D%7D/g;

/**
 * The URL a brand calls for one conversion: `<base>/postback/<orgKey>?<params>&sig=<hmac>`.
 * `{{placeholder}}` values are left unencoded so the result can be pasted as a template;
 * the signature of a template is only an example, the brand signs each real call itself.
 */
export function buildPostbackUrl(
  baseUrl: string,
  orgKey: string,
  params: PostbackParams,
  secret: string,
): string {
  const query = new URLSearchParams();
  for (const key of Object.keys(params).sort()) {
    if (key !== SIGNATURE_PARAM) query.set(key, params[key] ?? "");
  }
  query.set(SIGNATURE_PARAM, signPostbackQuery(params, secret));
  const encoded = query.toString().replace(TEMPLATE_PLACEHOLDER, "{{$1}}");
  return `${baseUrl.replace(/\/+$/, "")}/postback/${encodeURIComponent(orgKey)}?${encoded}`;
}

// ---------------------------------------------------------------------------
// Event key
// ---------------------------------------------------------------------------

export interface EventKeyInput {
  organisationId: string;
  type: PostbackType;
  dynamicId: string;
  /** The tracker's own event id, when it sends one. */
  clientEventKey?: string | undefined;
}

/**
 * The unique key of a conversion: the same organisation, type, dynamic id and client
 * event key always give the same value, so a tracker that retries a postback produces a
 * duplicate rather than a second lead or sale. Prefixed with the type for readability.
 */
export function deriveEventKey(input: EventKeyInput): string {
  const hash = createHash("sha256")
    .update(
      [input.organisationId, input.type, input.dynamicId, input.clientEventKey ?? ""].join("\n"),
    )
    .digest("hex")
    .slice(0, 32);
  return `${input.type}_${hash}`;
}

// ---------------------------------------------------------------------------
// Rates
// ---------------------------------------------------------------------------

export interface ConversionCounts {
  sent: number;
  leads: number;
  sales: number;
  costMicro: number;
}

export interface ConversionRates {
  /** Leads per message sent; 0 when nothing was sent. */
  leadRate: number;
  saleRate: number;
  /** Cost per lead in micro-EUR; null without leads. */
  cplMicro: number | null;
  cpsMicro: number | null;
}

function per(costMicro: number, count: number): number | null {
  return count > 0 ? Math.round(costMicro / count) : null;
}

/** Lead and sale rates and cost per conversion from counters. */
export function conversionRates(counts: ConversionCounts): ConversionRates {
  return {
    leadRate: counts.sent > 0 ? counts.leads / counts.sent : 0,
    saleRate: counts.sent > 0 ? counts.sales / counts.sent : 0,
    cplMicro: per(counts.costMicro, counts.leads),
    cpsMicro: per(counts.costMicro, counts.sales),
  };
}
