import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { Scalar } from "@scalar/hono-api-reference";
import {
  apiCampaignPageSchema,
  apiCampaignSchema,
  apiCampaignStatusResponseSchema,
  apiCreateCampaignSchema,
  apiErrorSchema,
  apiListCampaignsQuerySchema,
  apiListDetailSchema,
  apiListListsQuerySchema,
  apiListPageSchema,
  apiMeSchema,
  apiSendCampaignSchema,
  apiSendResponseSchema,
} from "@sendex/core";
import {
  CAMPAIGN_PAGE_SIZE,
  createCampaign,
  createLaps,
  type Db,
  estimateSend,
  getCampaign,
  getList,
  getOrganisationById,
  type ListListsOptions,
  listCampaigns,
  listLists,
  recordAudit,
  type SendingStore,
} from "@sendex/db";
import {
  RATE_LIMITS,
  type RateLimiterLike,
  type RateLimitPreset,
  rateLimit,
} from "@sendex/redis-utils";
import { log as defaultLog, type Logger } from "../log.js";
import type { ProgressTracker } from "../send/progress.js";
import { apiTokenAuth, type PublicApiEnv, scopeDenied } from "./auth.js";
import {
  toApiCampaign,
  toApiCampaignSummary,
  toApiList,
  toApiListDetail,
  toApiStatus,
} from "./serialise.js";

/**
 * The public API (D3-17): `/api/v1/*` behind per-organisation bearer tokens, with the
 * OpenAPI document at `/api/openapi.json` and a Scalar reference at `/api/docs`.
 * Documented in docs/engineering/public-api.md. Mount with `app.route("/", createPublicApi(deps))`.
 */

export interface PublicApiDeps {
  db: Db;
  store: Pick<SendingStore, "listCampaignLaps">;
  progress: Pick<ProgressTracker, "readCampaign">;
  /** Per-token sliding window; omitted (no Redis) means unthrottled. */
  rateLimit?: { limiter: RateLimiterLike; preset?: RateLimitPreset };
  /** Public origin of the worker, for the `servers` entry of the document. */
  serverUrl?: string;
  version?: string;
  log?: Logger;
}

export const LIST_PAGE_SIZE = 50;

const BEARER_AUTH = "bearerAuth";

const idParam = z.object({
  id: z.uuid().openapi({ param: { name: "id", in: "path" } }),
});

function json<T extends z.ZodType>(schema: T, description: string) {
  return { description, content: { "application/json": { schema } } };
}

const errorResponses = {
  401: json(apiErrorSchema, "Missing, malformed, unknown or revoked token"),
  429: json(apiErrorSchema, "Rate limit of the token exhausted; see the RateLimit-* headers"),
};

const notFound = json(apiErrorSchema, "No such resource in the token's organisation");
const forbidden = json(apiErrorSchema, "The token lacks the scope this call needs");
const validationFailed = json(apiErrorSchema, "The request did not validate");

// ---------------------------------------------------------------------------
// Route definitions (the OpenAPI document is generated from these)
// ---------------------------------------------------------------------------

const meRoute = createRoute({
  method: "get",
  path: "/api/v1/me",
  tags: ["Account"],
  summary: "The organisation and token behind the call",
  security: [{ [BEARER_AUTH]: [] }],
  responses: { 200: json(apiMeSchema, "Token and organisation"), ...errorResponses },
});

const listListsRoute = createRoute({
  method: "get",
  path: "/api/v1/lists",
  tags: ["Lists"],
  summary: "List the organisation's lists",
  description: `Newest first, ${LIST_PAGE_SIZE} per page. Needs the read scope.`,
  security: [{ [BEARER_AUTH]: [] }],
  request: { query: apiListListsQuerySchema },
  responses: {
    200: json(apiListPageSchema, "A page of lists"),
    400: validationFailed,
    403: forbidden,
    ...errorResponses,
  },
});

const getListRoute = createRoute({
  method: "get",
  path: "/api/v1/lists/{id}",
  tags: ["Lists"],
  summary: "One list with its member counts",
  security: [{ [BEARER_AUTH]: [] }],
  request: { params: idParam },
  responses: {
    200: json(apiListDetailSchema, "The list"),
    400: validationFailed,
    403: forbidden,
    404: notFound,
    ...errorResponses,
  },
});

const listCampaignsRoute = createRoute({
  method: "get",
  path: "/api/v1/campaigns",
  tags: ["Campaigns"],
  summary: "List the organisation's campaigns with their lap totals",
  description: `Newest first, ${CAMPAIGN_PAGE_SIZE} per page. Needs the read scope.`,
  security: [{ [BEARER_AUTH]: [] }],
  request: { query: apiListCampaignsQuerySchema },
  responses: {
    200: json(apiCampaignPageSchema, "A page of campaigns"),
    400: validationFailed,
    403: forbidden,
    ...errorResponses,
  },
});

const getCampaignRoute = createRoute({
  method: "get",
  path: "/api/v1/campaigns/{id}",
  tags: ["Campaigns"],
  summary: "One campaign: lists, sender ids, texts, links, laps and counters",
  security: [{ [BEARER_AUTH]: [] }],
  request: { params: idParam },
  responses: {
    200: json(apiCampaignSchema, "The campaign"),
    400: validationFailed,
    403: forbidden,
    404: notFound,
    ...errorResponses,
  },
});

const createCampaignRoute = createRoute({
  method: "post",
  path: "/api/v1/campaigns",
  tags: ["Campaigns"],
  summary: "Create a draft campaign",
  description:
    "Needs the write scope. Lists, sender ids, texts and links are attached in the dashboard; the timezone defaults to the country's.",
  security: [{ [BEARER_AUTH]: [] }],
  request: { body: { content: { "application/json": { schema: apiCreateCampaignSchema } } } },
  responses: {
    201: json(apiCampaignSchema, "The new draft"),
    400: validationFailed,
    403: forbidden,
    ...errorResponses,
  },
});

const sendCampaignRoute = createRoute({
  method: "post",
  path: "/api/v1/campaigns/{id}/send",
  tags: ["Campaigns"],
  summary: "Queue the campaign's laps on the given routes",
  description:
    "Needs the send scope. Same rules as the dashboard's Send button: one test lap of `testSize` contacts per list and route, or everything with `sendAll`. The campaign becomes `sending` (or `scheduled` when it has a future start time).",
  security: [{ [BEARER_AUTH]: [] }],
  request: {
    params: idParam,
    body: { content: { "application/json": { schema: apiSendCampaignSchema } } },
  },
  responses: {
    201: json(apiSendResponseSchema, "The queued laps"),
    400: validationFailed,
    403: forbidden,
    404: notFound,
    422: json(
      apiErrorSchema,
      "The campaign cannot be sent as it is (no list, route, text, sender id or contacts left)",
    ),
    ...errorResponses,
  },
});

const campaignStatusRoute = createRoute({
  method: "get",
  path: "/api/v1/campaigns/{id}/status",
  tags: ["Campaigns"],
  summary: "Live sending progress and counters of a campaign",
  description:
    "`progress` is the engine's live count (sent and failed so far, per lap); `counters` are the stored lap totals including delivered, clicks, leads and sales.",
  security: [{ [BEARER_AUTH]: [] }],
  request: { params: idParam },
  responses: {
    200: json(apiCampaignStatusResponseSchema, "Status, progress and counters"),
    400: validationFailed,
    403: forbidden,
    404: notFound,
    ...errorResponses,
  },
});

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

/** `createLaps` refuses with plain errors; these become 422 (or 404), anything else is a 500. */
const SEND_REFUSALS = /^(Pick |Add |Nothing to send)/;

export function createPublicApi(deps: PublicApiDeps) {
  const log = deps.log ?? defaultLog;
  const app = new OpenAPIHono<PublicApiEnv>({
    defaultHook: (result, c) => {
      if (!result.success) {
        return c.json({ error: "validation_failed", issues: z.prettifyError(result.error) }, 400);
      }
    },
  });

  app.openAPIRegistry.registerComponent("securitySchemes", BEARER_AUTH, {
    type: "http",
    scheme: "bearer",
    description: "An API token from Settings → API tokens (`sdx_…`).",
  });

  app.use("/api/v1/*", apiTokenAuth(deps.db, log));
  if (deps.rateLimit) {
    app.use(
      "/api/v1/*",
      rateLimit<PublicApiEnv>(deps.rateLimit.limiter, {
        preset: deps.rateLimit.preset ?? RATE_LIMITS.publicApi,
        keyFrom: (c) => c.var.apiToken.id,
      }),
    );
  }

  app.openapi(meRoute, async (c) => {
    const token = c.var.apiToken;
    const organisation = await getOrganisationById(deps.db, token.organisationId);
    if (organisation === null) return c.json({ error: "unauthorised" }, 401);
    return c.json(
      {
        organisation: { id: organisation.id, name: organisation.name, slug: organisation.slug },
        token: {
          id: token.id,
          name: token.name,
          prefix: token.prefix,
          scopes: token.scopes,
          createdAt: token.createdAt.toISOString(),
        },
      },
      200,
    );
  });

  app.openapi(listListsRoute, async (c) => {
    const denied = scopeDenied(c, "read");
    if (denied) return c.json(denied, 403);
    const query = c.req.valid("query");
    const options: ListListsOptions = { page: query.page, pageSize: LIST_PAGE_SIZE };
    if (query.search !== undefined) options.search = query.search;
    if (query.country !== undefined) options.country = query.country;
    const result = await listLists(deps.db, c.var.apiToken.organisationId, options);
    return c.json(
      {
        items: result.rows.map(toApiList),
        page: query.page,
        pageSize: LIST_PAGE_SIZE,
        total: result.total,
      },
      200,
    );
  });

  app.openapi(getListRoute, async (c) => {
    const denied = scopeDenied(c, "read");
    if (denied) return c.json(denied, 403);
    const list = await getList(deps.db, c.var.apiToken.organisationId, c.req.valid("param").id);
    if (list === null) return c.json({ error: "list not found" }, 404);
    return c.json(toApiListDetail(list), 200);
  });

  app.openapi(listCampaignsRoute, async (c) => {
    const denied = scopeDenied(c, "read");
    if (denied) return c.json(denied, 403);
    const query = c.req.valid("query");
    const page = await listCampaigns(deps.db, c.var.apiToken.organisationId, {
      page: query.page,
      ...(query.search !== undefined ? { search: query.search } : {}),
      ...(query.country !== undefined ? { country: query.country } : {}),
      ...(query.status !== undefined ? { status: query.status } : {}),
    });
    return c.json(
      {
        items: page.items.map(toApiCampaignSummary),
        page: page.page,
        pageSize: page.pageSize,
        total: page.total,
      },
      200,
    );
  });

  app.openapi(getCampaignRoute, async (c) => {
    const denied = scopeDenied(c, "read");
    if (denied) return c.json(denied, 403);
    const campaign = await getCampaign(
      deps.db,
      c.var.apiToken.organisationId,
      c.req.valid("param").id,
    );
    if (campaign === null) return c.json({ error: "campaign not found" }, 404);
    return c.json(toApiCampaign(campaign), 200);
  });

  app.openapi(createCampaignRoute, async (c) => {
    const denied = scopeDenied(c, "write");
    if (denied) return c.json(denied, 403);
    const token = c.var.apiToken;
    const input = c.req.valid("json");
    const row = await createCampaign(deps.db, token.organisationId, { ...input, createdBy: null });
    await recordAudit(deps.db, token.organisationId, {
      actorUserId: null,
      action: "campaign.create",
      targetType: "campaign",
      targetId: row.id,
      details: {
        name: row.name,
        country: row.country,
        timezone: row.timezone,
        source: "api",
        tokenId: token.id,
        tokenName: token.name,
      },
    });
    log("info", "campaign created via public api", {
      campaignId: row.id,
      organisationId: token.organisationId,
      tokenId: token.id,
    });
    const detail = await getCampaign(deps.db, token.organisationId, row.id);
    if (detail === null) throw new Error("campaign vanished after insert");
    return c.json(toApiCampaign(detail), 201);
  });

  app.openapi(sendCampaignRoute, async (c) => {
    const denied = scopeDenied(c, "send");
    if (denied) return c.json(denied, 403);
    const token = c.var.apiToken;
    const campaignId = c.req.valid("param").id;
    const options = c.req.valid("json");
    const organisationId = token.organisationId;
    if ((await getCampaign(deps.db, organisationId, campaignId)) === null) {
      return c.json({ error: "campaign not found" }, 404);
    }
    try {
      const estimate = await estimateSend(deps.db, organisationId, campaignId, options);
      const laps = await createLaps(deps.db, organisationId, campaignId, {
        ...options,
        actorUserId: null,
      });
      await recordAudit(deps.db, organisationId, {
        actorUserId: null,
        action: "api.campaign.send",
        targetType: "campaign",
        targetId: campaignId,
        details: {
          tokenId: token.id,
          tokenName: token.name,
          lapIds: laps.map((l) => l.id),
          smsCount: estimate.smsCount,
          costMicro: estimate.costMicro.toString(),
        },
      });
      log("info", "campaign sent via public api", {
        campaignId,
        organisationId,
        tokenId: token.id,
        laps: laps.length,
        smsCount: estimate.smsCount,
      });
      const after = await getCampaign(deps.db, organisationId, campaignId);
      return c.json(
        {
          campaignId,
          status: after?.status ?? "sending",
          smsCount: estimate.smsCount,
          costMicro: estimate.costMicro.toString(),
          laps: laps.map((l) => ({
            id: l.id,
            listId: l.listId,
            routeId: l.routeId,
            testSize: l.testSize,
            status: l.status,
          })),
        },
        201,
      );
    } catch (error) {
      if (error instanceof Error && SEND_REFUSALS.test(error.message)) {
        return c.json({ error: error.message }, 422);
      }
      throw error;
    }
  });

  app.openapi(campaignStatusRoute, async (c) => {
    const denied = scopeDenied(c, "read");
    if (denied) return c.json(denied, 403);
    const organisationId = c.var.apiToken.organisationId;
    const campaignId = c.req.valid("param").id;
    const campaign = await getCampaign(deps.db, organisationId, campaignId);
    if (campaign === null) return c.json({ error: "campaign not found" }, 404);
    const laps = await deps.store.listCampaignLaps(organisationId, campaignId);
    const progress = await deps.progress.readCampaign(campaignId, laps);
    return c.json(toApiStatus(campaign, progress), 200);
  });

  // The document and the reference are public: they describe the API, not any data.
  app.doc31("/api/openapi.json", {
    openapi: "3.1.0",
    info: {
      title: "Sendex API",
      version: deps.version ?? "1",
      description:
        "Lists, campaigns, sending and status for one organisation. Authenticate with `Authorization: Bearer <token>`; tokens are created under Settings → API tokens and carry the scopes read, write and send.",
    },
    servers: [{ url: deps.serverUrl ?? "http://localhost:4000" }],
  });
  app.get("/api/docs", Scalar({ url: "/api/openapi.json", pageTitle: "Sendex API" }));

  return app;
}
