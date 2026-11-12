/**
 * Conversion postbacks: the parameters a brand's tracker sends back when a contact who
 * clicked a tracked link registers (lead) or pays (sale), the HMAC signature that proves
 * the call came from the brand, and the deterministic event key that makes a re-sent
 * postback a duplicate instead of a second conversion. Pure functions shared by the
 * worker (verifies and ingests), the web app (shows the URL to configure) and the docs.
 */
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

/** Another name for `dynamic_id`, as in SMS Edge's `postback.php?type=lead&key=…` (D4-11). */
export const DYNAMIC_ID_ALIAS = "key";

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
  // SMS Edge's postback names the id `key`; accept it so a tracker set up for SMS Edge only
  // needs its address changed. `dynamic_id` wins when both are sent.
  const withId =
    raw.dynamic_id === undefined && raw[DYNAMIC_ID_ALIAS] !== undefined
      ? { ...raw, dynamic_id: raw[DYNAMIC_ID_ALIAS] }
      : raw;
  const parsed = incomingPostbackShape.safeParse(withId);
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

/*
 * Web Crypto (`crypto.subtle`) rather than `node:crypto`: this module is shared by the
 * worker (Node), the Next.js app (whose middleware bundle runs on the Edge runtime and
 * cannot load `node:` modules) and potentially the links service on Cloudflare. The
 * price is that signing and hashing are asynchronous.
 */

const encoder = new TextEncoder();

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(text: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(text.length / 2));
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(text.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** Named through `crypto.subtle` so no DOM or Node type for `CryptoKey` is needed. */
type HmacKey = Awaited<ReturnType<typeof crypto.subtle.importKey>>;

function hmacKey(secret: string, usage: "sign" | "verify"): Promise<HmacKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    [usage],
  );
}

/** Lower-case hex HMAC-SHA256 of the canonical query under the organisation's secret. */
export async function signPostbackQuery(params: PostbackParams, secret: string): Promise<string> {
  const key = await hmacKey(secret, "sign");
  return hex(await crypto.subtle.sign("HMAC", key, encoder.encode(canonicalPostbackQuery(params))));
}

const HEX_SIGNATURE = /^[0-9a-fA-F]{64}$/;

/**
 * Check `sig` against the expected signature; false for anything malformed or an empty
 * secret. `crypto.subtle.verify` compares in constant time.
 */
export async function verifyPostbackSignature(
  params: PostbackParams,
  sig: string | undefined,
  secret: string,
): Promise<boolean> {
  if (secret === "" || sig === undefined || !HEX_SIGNATURE.test(sig)) return false;
  const key = await hmacKey(secret, "verify");
  return crypto.subtle.verify(
    "HMAC",
    key,
    fromHex(sig.toLowerCase()),
    encoder.encode(canonicalPostbackQuery(params)),
  );
}

const TEMPLATE_PLACEHOLDER = /%7B%7B([A-Za-z0-9_]+)%7D%7D/g;

/**
 * The URL a brand calls for one conversion: `<base>/postback/<orgKey>?<params>&sig=<hmac>`.
 * `{{placeholder}}` values are left unencoded so the result can be pasted as a template;
 * the signature of a template is only an example, the brand signs each real call itself.
 */
export async function buildPostbackUrl(
  baseUrl: string,
  orgKey: string,
  params: PostbackParams,
  secret: string,
): Promise<string> {
  const query = new URLSearchParams();
  for (const key of Object.keys(params).sort()) {
    if (key !== SIGNATURE_PARAM) query.set(key, params[key] ?? "");
  }
  query.set(SIGNATURE_PARAM, await signPostbackQuery(params, secret));
  const encoded = query.toString().replace(TEMPLATE_PLACEHOLDER, "{{$1}}");
  return `${baseUrl.replace(/\/+$/, "")}/postback/${encodeURIComponent(orgKey)}?${encoded}`;
}

// ---------------------------------------------------------------------------
// Simple postback URL (D4-11, ADR 0010)
// ---------------------------------------------------------------------------

/** What the token is an HMAC of; changing it would invalidate every simple postback URL. */
const TOKEN_CONTEXT = "sendex:postback-token:v1";

/**
 * The token of the simple postback URL, for trackers that can only call a plain address with
 * placeholders and cannot sign: `<base>/postback/<orgKey>/<token>?type=lead&key=<id>`. It is
 * derived from the organisation's postback secret, so it needs no storage, changes when the
 * secret is rotated, and never reveals the secret that signs the other URL.
 */
export async function derivePostbackToken(secret: string): Promise<string> {
  const key = await hmacKey(secret, "sign");
  return hex(await crypto.subtle.sign("HMAC", key, encoder.encode(TOKEN_CONTEXT)));
}

/** Check a token from the URL path in constant time; false for anything malformed. */
export async function verifyPostbackToken(
  token: string | undefined,
  secret: string,
): Promise<boolean> {
  if (secret === "" || token === undefined || !HEX_SIGNATURE.test(token)) return false;
  const key = await hmacKey(secret, "verify");
  return crypto.subtle.verify(
    "HMAC",
    key,
    fromHex(token.toLowerCase()),
    encoder.encode(TOKEN_CONTEXT),
  );
}

/**
 * The simple URL to paste into a tracker, `{{dynamic}}` and `{{amount}}` standing for the
 * tracker's own macros. A sale carries the optional `value`.
 */
export function buildSimplePostbackUrl(
  baseUrl: string,
  orgKey: string,
  token: string,
  type: PostbackType,
): string {
  const base = `${baseUrl.replace(/\/+$/, "")}/postback/${encodeURIComponent(orgKey)}/${token}`;
  const query = `type=${type}&${DYNAMIC_ID_ALIAS}={{dynamic}}`;
  return `${base}?${query}${type === "sale" ? "&value={{amount}}" : ""}`;
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
export async function deriveEventKey(input: EventKeyInput): Promise<string> {
  const material = [
    input.organisationId,
    input.type,
    input.dynamicId,
    input.clientEventKey ?? "",
  ].join("\n");
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(material));
  return `${input.type}_${hex(digest).slice(0, 32)}`;
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
