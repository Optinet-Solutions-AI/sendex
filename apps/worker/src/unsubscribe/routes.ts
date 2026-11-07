import { normaliseSuppressionNumber } from "@sendex/core";
import { addSuppressions, type Db, findOrganisationByKey, suppressByDynamicId } from "@sendex/db";
import { Hono } from "hono";
import { log as defaultLog, type Logger } from "../log.js";

export interface UnsubscribeRoutesDeps {
  db: Db;
  /** Optional limiter keyed by organisation id; resolve false to refuse with 429. */
  rateLimit?: (organisationId: string) => Promise<boolean>;
  log?: Logger;
}

/**
 * The Unsubscribe API of the spec: `GET|POST /unsubscribe/:orgKey?type=rm-fk&fk=<dynamic>`
 * suppresses the contact a tracked message went to, `?type=rm-u&number=<E.164>` suppresses
 * a number directly. Account-wide and immediate: the send loop skips suppressed numbers.
 * The organisation key (id or slug) is the only credential, as in SMS Edge; the endpoint
 * never reveals whether a number or id exists beyond `unsubscribed: true|false`.
 */
export function createUnsubscribeRoutes(deps: UnsubscribeRoutesDeps) {
  const log = deps.log ?? defaultLog;
  const app = new Hono();

  app.on(["GET", "POST"], "/unsubscribe/:orgKey", async (c) => {
    const organisation = await findOrganisationByKey(deps.db, c.req.param("orgKey"));
    if (organisation === null) return c.json({ error: "unknown organisation" }, 404);
    if (deps.rateLimit && !(await deps.rateLimit(organisation.id))) {
      return c.json({ error: "too many requests" }, 429);
    }
    const params: Record<string, string> = { ...c.req.query() };
    if (c.req.method === "POST") {
      const contentType = c.req.header("content-type") ?? "";
      if (contentType.includes("application/json")) {
        const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
        for (const [k, v] of Object.entries(body ?? {})) if (typeof v === "string") params[k] = v;
      } else if (contentType.includes("form")) {
        for (const [k, v] of Object.entries(await c.req.parseBody())) {
          if (typeof v === "string") params[k] = v;
        }
      }
    }
    const type = params.type ?? "";
    if (type === "rm-fk") {
      const fk = params.fk?.trim() ?? "";
      if (fk === "") return c.json({ error: "fk is required" }, 400);
      const result = await suppressByDynamicId(deps.db, organisation.id, fk);
      log("info", "unsubscribe by dynamic id", {
        organisationId: organisation.id,
        found: !!result,
      });
      return c.json({ ok: true, unsubscribed: result !== null, added: result?.added ?? false });
    }
    if (type === "rm-u") {
      const parsed = normaliseSuppressionNumber(params.number ?? "");
      if (!parsed) return c.json({ error: "number must be in international format" }, 400);
      const added = await addSuppressions(deps.db, organisation.id, {
        numbers: [parsed],
        source: "api",
      });
      log("info", "unsubscribe by number", { organisationId: organisation.id, added: added > 0 });
      return c.json({ ok: true, unsubscribed: true, added: added > 0 });
    }
    return c.json({ error: "type must be rm-fk or rm-u" }, 400);
  });

  return app;
}
