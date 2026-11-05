import { type ApiTokenScope, bearerToken, hashApiToken, tokenHasScope } from "@sendex/core";
import { type Db, findApiTokenByHash } from "@sendex/db";
import type { Context, MiddlewareHandler } from "hono";
import type { Logger } from "../log.js";

/** The token a request authenticated with; what every handler scopes its queries by. */
export interface AuthenticatedToken {
  id: string;
  organisationId: string;
  name: string;
  prefix: string;
  scopes: ApiTokenScope[];
  createdAt: Date;
}

export type PublicApiEnv = { Variables: { apiToken: AuthenticatedToken } };

export const WWW_AUTHENTICATE = "Bearer";

/**
 * `Authorization: Bearer sdx_…` → the live token row → `c.var.apiToken`. Anything else is
 * 401. The plaintext never leaves this function: only its hash is looked up or logged.
 */
export function apiTokenAuth(db: Db, log: Logger): MiddlewareHandler<PublicApiEnv> {
  return async (c, next) => {
    const token = bearerToken(c.req.header("authorization"));
    const row = token === null ? null : await findApiTokenByHash(db, await hashApiToken(token));
    if (row === null) {
      log("warn", "public api: unauthorised", { path: c.req.path, hasToken: token !== null });
      c.header("WWW-Authenticate", WWW_AUTHENTICATE);
      return c.json({ error: "unauthorised" }, 401);
    }
    c.set("apiToken", {
      id: row.id,
      organisationId: row.organisationId,
      name: row.name,
      prefix: row.prefix,
      scopes: row.scopes,
      createdAt: row.createdAt,
    });
    await next();
  };
}

/** The 403 body when a token lacks `scope`, or null when it has it. */
export function scopeDenied(
  c: Context<PublicApiEnv>,
  scope: ApiTokenScope,
): { error: "forbidden"; issues: string } | null {
  return tokenHasScope(c.var.apiToken.scopes, scope)
    ? null
    : { error: "forbidden", issues: `token lacks the ${scope} scope` };
}
