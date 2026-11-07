import { db, listApiTokens } from "@sendex/db";
import { PageHeader } from "@sendex/ui";
import { workerPublicUrl } from "../../../../lib/worker-public-url";
import { RequireOrg } from "../../require-org";
import { ApiTokensPanel, type ApiTokenView } from "./api-tokens-panel";

export const dynamic = "force-dynamic";

/**
 * Settings → API tokens: the organisation's tokens for the public API, with create (the
 * plaintext shown once) and revoke. Owner only (`settings.manage`).
 */
export default function ApiTokensPage() {
  return (
    <RequireOrg action="settings.manage">
      {async (ctx) => {
        const rows = await listApiTokens(db(), ctx.organisationId);
        const tokens: ApiTokenView[] = rows.map((row) => ({
          id: row.id,
          name: row.name,
          prefix: row.prefix,
          scopes: row.scopes,
          createdAt: row.createdAt.toISOString(),
          lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
          revokedAt: row.revokedAt?.toISOString() ?? null,
        }));
        return (
          <section className="max-w-3xl space-y-6">
            <PageHeader
              breadcrumb={[{ label: "Settings", href: "/settings" }, { label: "API tokens" }]}
              title="API tokens"
              subtitle="Tokens let your own systems read lists and campaigns, create campaigns and queue sends through the public API. Each token is shown once when it is created; Sendex keeps only a hash. Revoke a token the moment it may have leaked."
            />
            <ApiTokensPanel tokens={tokens} apiBaseUrl={workerPublicUrl()} />
          </section>
        );
      }}
    </RequireOrg>
  );
}
