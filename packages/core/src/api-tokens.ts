/**
 * The public API (D3-17): bearer tokens per organisation and the request / response shapes
 * of `/api/v1/*`. Pure: the worker validates with these, the web app's settings page creates
 * tokens with them, and the OpenAPI spec is generated from them.
 *
 * A token is `sdx_` plus 32 random bytes as URL-safe base64. Only its SHA-256 is stored; the
 * plaintext is shown once, at creation. Web Crypto, like postbacks.ts, so the same code runs
 * in the worker (Node) and in the Next.js app.
 */
import { z } from "zod";
import {
  CONTACT_REUSE,
  countrySchema,
  newCampaignSchema,
  timezoneForCountry,
  timezoneSchema,
} from "./campaigns.js";

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

export const API_TOKEN_SCOPES = ["read", "write", "send"] as const;
export type ApiTokenScope = (typeof API_TOKEN_SCOPES)[number];
export const apiTokenScopeSchema = z.enum(API_TOKEN_SCOPES);

export const API_TOKEN_SCOPE_DESCRIPTIONS: Readonly<Record<ApiTokenScope, string>> = {
  read: "List and read lists, campaigns and their status",
  write: "Create campaigns",
  send: "Queue sends for a campaign",
};

/** Plain membership: `send` does not imply `write`, `write` does not imply `read`. */
export function tokenHasScope(scopes: readonly ApiTokenScope[], required: ApiTokenScope): boolean {
  return scopes.includes(required);
}

export const API_TOKEN_PREFIX = "sdx_";

/** How many characters after the prefix are kept for display (`sdx_abcdefgh…`). */
const DISPLAY_BODY_LENGTH = 8;

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A fresh token: `sdx_` plus 43 URL-safe characters (32 random bytes). */
export function generateApiToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `${API_TOKEN_PREFIX}${base64url(bytes)}`;
}

/** The part of a token that is safe to show in a list: `sdx_` plus its first eight characters. */
export function displayPrefix(token: string): string {
  return token.slice(0, API_TOKEN_PREFIX.length + DISPLAY_BODY_LENGTH);
}

const encoder = new TextEncoder();

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Lower-case hex SHA-256 of the token: what is stored and what a request is looked up by. */
export async function hashApiToken(token: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", encoder.encode(token)));
}

const BEARER = /^bearer\s+(\S+)\s*$/i;

/** The token of an `Authorization: Bearer <token>` header, or null for anything else. */
export function bearerToken(header: string | undefined): string | null {
  if (header === undefined) return null;
  const match = BEARER.exec(header);
  return match?.[1] ?? null;
}

/** The "Create token" form in Settings → API tokens. */
export const newApiTokenSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(60, "Name is at most 60 characters"),
  scopes: z
    .array(apiTokenScopeSchema)
    .min(1, "Pick at least one scope")
    .transform((scopes) => [...new Set(scopes)]),
});
export type NewApiToken = z.infer<typeof newApiTokenSchema>;

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

/** `POST /api/v1/campaigns`: the web form's schema, with the timezone derived from the country. */
export const apiCreateCampaignSchema = newCampaignSchema
  .extend({ timezone: timezoneSchema.optional() })
  .transform((input) => ({
    name: input.name,
    country: input.country,
    timezone: input.timezone ?? timezoneForCountry(input.country),
  }));
export type ApiCreateCampaign = z.infer<typeof apiCreateCampaignSchema>;

/** `POST /api/v1/campaigns/:id/send`: the same options the web send form posts. */
export const apiSendCampaignSchema = z.object({
  routeIds: z.array(z.uuid()).min(1, "Pick at least one route"),
  sendAll: z.boolean().default(false),
});
export type ApiSendCampaign = z.infer<typeof apiSendCampaignSchema>;

export const apiPaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
});

export const apiListCampaignsQuerySchema = apiPaginationSchema.extend({
  search: z.string().trim().min(1).max(120).optional(),
  country: countrySchema.optional(),
  status: z.enum(["draft", "scheduled", "sending", "paused", "stopped", "completed"]).optional(),
});

export const apiListListsQuerySchema = apiPaginationSchema.extend({
  search: z.string().trim().min(1).max(120).optional(),
  country: countrySchema.optional(),
});

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

const isoDate = z.iso.datetime();
const nullableIsoDate = isoDate.nullable();
/** Micro-EUR as a decimal string: int8 does not fit JSON numbers. */
const microString = z.string().regex(/^-?\d+$/);

export const apiErrorSchema = z.object({
  error: z.string(),
  issues: z.string().optional(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

export const apiListSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  country: z.string(),
  numbersCount: z.number().int(),
  sent: z.number().int(),
  lastSentAt: nullableIsoDate,
  lastUploadAt: nullableIsoDate,
  createdAt: isoDate,
});
export type ApiList = z.infer<typeof apiListSchema>;

export const apiListDetailSchema = apiListSchema.extend({
  counts: z.object({
    members: z.number().int(),
    available: z.number().int(),
    sent: z.number().int(),
    bad: z.number().int(),
  }),
});
export type ApiListDetail = z.infer<typeof apiListDetailSchema>;

export const apiPageSchema = z.object({
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});

export const apiListPageSchema = z.object({
  items: z.array(apiListSchema),
  ...apiPageSchema.shape,
});

export const apiCampaignStatusSchema = z.enum([
  "draft",
  "scheduled",
  "sending",
  "paused",
  "stopped",
  "completed",
]);

export const apiCampaignSummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  country: z.string(),
  timezone: z.string(),
  status: apiCampaignStatusSchema,
  createdAt: isoDate,
  lapsCount: z.number().int(),
  sent: z.number().int(),
  clicks: z.number().int(),
  ctr: z.number(),
  costMicro: microString,
  leads: z.number().int(),
  sales: z.number().int(),
  firstLapAt: nullableIsoDate,
  lastLapAt: nullableIsoDate,
});
export type ApiCampaignSummary = z.infer<typeof apiCampaignSummarySchema>;

export const apiCampaignPageSchema = z.object({
  items: z.array(apiCampaignSummarySchema),
  ...apiPageSchema.shape,
});

export const apiLapSchema = z.object({
  id: z.uuid(),
  listId: z.uuid(),
  listName: z.string(),
  routeId: z.uuid(),
  routeName: z.string(),
  status: z.enum(["queued", "sending", "done", "cancelled"]),
  testSize: z.number().int(),
  sent: z.number().int(),
  delivered: z.number().int(),
  failed: z.number().int(),
  clicks: z.number().int(),
  leads: z.number().int(),
  sales: z.number().int(),
  costMicro: microString,
  revenueMicro: microString,
  rank: z.number().int().nullable(),
  startedAt: nullableIsoDate,
  finishedAt: nullableIsoDate,
  createdAt: isoDate,
});
export type ApiLap = z.infer<typeof apiLapSchema>;

/** Lap counters summed over the campaign. */
export const apiCountersSchema = z.object({
  sent: z.number().int(),
  delivered: z.number().int(),
  failed: z.number().int(),
  clicks: z.number().int(),
  leads: z.number().int(),
  sales: z.number().int(),
  costMicro: microString,
  revenueMicro: microString,
});
export type ApiCounters = z.infer<typeof apiCountersSchema>;

export const apiCampaignSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  country: z.string(),
  timezone: z.string(),
  status: apiCampaignStatusSchema,
  contactReuse: z.enum(CONTACT_REUSE),
  testSize: z.number().int(),
  scheduledAt: nullableIsoDate,
  createdAt: isoDate,
  updatedAt: isoDate,
  lists: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      country: z.string(),
      numbersCount: z.number().int(),
      available: z.number().int(),
    }),
  ),
  senderIds: z.array(z.string()),
  adTexts: z.array(
    z.object({
      id: z.uuid(),
      text: z.string(),
      encoding: z.string(),
      parts: z.number().int(),
      active: z.boolean(),
    }),
  ),
  links: z.array(
    z.object({ id: z.uuid(), name: z.string(), url: z.string(), active: z.boolean() }),
  ),
  laps: z.array(apiLapSchema),
  counters: apiCountersSchema,
});
export type ApiCampaign = z.infer<typeof apiCampaignSchema>;

export const apiProgressSchema = z.object({
  sent: z.number().int(),
  failed: z.number().int(),
  total: z.number().int(),
  laps: z.array(
    z.object({
      lapId: z.uuid(),
      status: z.enum(["queued", "sending", "done", "cancelled"]),
      sent: z.number().int(),
      failed: z.number().int(),
      total: z.number().int(),
    }),
  ),
});

export const apiCampaignStatusResponseSchema = z.object({
  id: z.uuid(),
  status: apiCampaignStatusSchema,
  scheduledAt: nullableIsoDate,
  progress: apiProgressSchema,
  counters: apiCountersSchema,
});
export type ApiCampaignStatusResponse = z.infer<typeof apiCampaignStatusResponseSchema>;

export const apiSendResponseSchema = z.object({
  campaignId: z.uuid(),
  status: apiCampaignStatusSchema,
  smsCount: z.number().int(),
  costMicro: microString,
  laps: z.array(
    z.object({
      id: z.uuid(),
      listId: z.uuid(),
      routeId: z.uuid(),
      testSize: z.number().int(),
      status: z.enum(["queued", "sending", "done", "cancelled"]),
    }),
  ),
});
export type ApiSendResponse = z.infer<typeof apiSendResponseSchema>;

export const apiMeSchema = z.object({
  organisation: z.object({ id: z.uuid(), name: z.string(), slug: z.string() }),
  token: z.object({
    id: z.uuid(),
    name: z.string(),
    prefix: z.string(),
    scopes: z.array(apiTokenScopeSchema),
    createdAt: isoDate,
  }),
});
export type ApiMe = z.infer<typeof apiMeSchema>;
