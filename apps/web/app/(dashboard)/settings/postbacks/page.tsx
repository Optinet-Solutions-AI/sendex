import { buildPostbackUrl, can, canonicalPostbackQuery, signPostbackQuery } from "@sendex/core";
import { db, findOrganisationByKey, getOrCreatePostbackKey } from "@sendex/db";
import { PageHeader } from "@sendex/ui";
import Link from "next/link";
import { formatDateTime } from "../../../../lib/format";
import { workerPublicUrl } from "../../../../lib/worker-public-url";
import { RequireOrg } from "../../require-org";
import { RotateSecretButton } from "./rotate-secret-button";

export const dynamic = "force-dynamic";

const EXAMPLE_DYNAMIC = "7b1c3e2a-5d4f-4c6b-8a9e-0f1d2c3b4a59";
/** Stands in for the worker's address in the templates until it is deployed. */
const WORKER_PLACEHOLDER = "https://<worker-address>";

function Code({ children }: { children: string }) {
  return (
    <code className="block overflow-x-auto whitespace-pre rounded bg-neutral-100 px-3 py-2 font-mono text-xs">
      {children}
    </code>
  );
}

/**
 * The organisation's postback URL and secret for the brand's tracker, with the signature
 * explained step by step. Owners can rotate the secret.
 */
export default function PostbackSettingsPage() {
  return (
    <RequireOrg action="settings.view">
      {async (ctx) => {
        const database = db();
        const [organisation, key] = await Promise.all([
          findOrganisationByKey(database, ctx.organisationId),
          getOrCreatePostbackKey(database, ctx.organisationId),
        ]);
        const orgKey = organisation?.slug ?? ctx.organisationId;
        const workerUrl = workerPublicUrl();
        const base = workerUrl ?? WORKER_PLACEHOLDER;
        const leadTemplate = (
          await buildPostbackUrl(
            base,
            orgKey,
            { type: "lead", dynamic_id: "{{dynamic}}" },
            key.secret,
          )
        ).replace(/sig=[0-9a-f]+$/, "sig=<signature>");
        const saleTemplate = (
          await buildPostbackUrl(
            base,
            orgKey,
            { type: "sale", dynamic_id: "{{dynamic}}", value: "{{amount}}" },
            key.secret,
          )
        ).replace(/sig=[0-9a-f]+$/, "sig=<signature>");
        const exampleParams = { type: "lead", dynamic_id: EXAMPLE_DYNAMIC };
        const exampleUrl = await buildPostbackUrl(base, orgKey, exampleParams, key.secret);
        return (
          <section className="max-w-3xl space-y-6">
            <PageHeader
              breadcrumb={[{ label: "Settings", href: "/settings" }, { label: "Postbacks" }]}
              title="Postbacks"
            />
            <div>
              <p className="text-sm text-muted">
                Give these to the brand (or its tracker) so registrations and sales come back to
                Sendex and show on the campaign and in{" "}
                <Link href="/reports/postbacks" className="underline">
                  Postback Logs
                </Link>
                .
              </p>
            </div>

            {workerUrl ? null : (
              <p
                role="status"
                data-testid="worker-not-deployed"
                className="rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
              >
                The worker service is not deployed yet, so these URLs cannot receive calls. The
                templates below show the shape; <code>{WORKER_PLACEHOLDER}</code> becomes the
                worker's address once it is live.
              </p>
            )}

            <div className="space-y-3 rounded border border-neutral-200 bg-white p-4">
              <h2 className="text-sm font-semibold">Postback URL</h2>
              <p className="text-sm text-neutral-600">
                Call it with <code>GET</code> or <code>POST</code> once per conversion.{" "}
                <code>{"{{dynamic}}"}</code> is the value the tracked link passed to the brand (the{" "}
                <code>dynamic</code> placeholder); it ties the conversion back to the message.
              </p>
              <p className="text-xs font-medium uppercase text-neutral-500">Lead / registration</p>
              <Code>{leadTemplate}</Code>
              <p className="text-xs font-medium uppercase text-neutral-500">Sale / deposit</p>
              <Code>{saleTemplate}</Code>
              <p className="text-sm text-neutral-600">
                <code>type</code> also accepts <code>registration</code>, <code>deposit</code> and{" "}
                <code>ftd</code>. <code>value</code> is the amount in EUR (<code>12.50</code>). Add{" "}
                <code>event_key</code> with the tracker's own event id when one contact can convert
                more than once; without it, a second postback of the same type for the same dynamic
                id is ignored as a repeat.
              </p>
            </div>

            <div className="space-y-3 rounded border border-neutral-200 bg-white p-4">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold">Secret</h2>
                {can(ctx.role, "settings.manage") ? <RotateSecretButton /> : null}
              </div>
              <Code>{key.secret}</Code>
              <p className="text-xs text-neutral-500" data-testid="secret-dates">
                Created {formatDateTime(key.createdAt)}
                {key.rotatedAt ? ` · rotated ${formatDateTime(key.rotatedAt)}` : ""}
              </p>
            </div>

            <div className="space-y-3 rounded border border-neutral-200 bg-white p-4">
              <h2 className="text-sm font-semibold">How to sign a call</h2>
              <ol className="list-decimal space-y-2 pl-5 text-sm text-neutral-700">
                <li>
                  Take every parameter except <code>sig</code>, sort them by name and join them as{" "}
                  <code>name=value</code> with <code>&amp;</code>, percent-encoding names and values
                  (<code>encodeURIComponent</code>).
                </li>
                <li>
                  Compute HMAC-SHA256 of that string with the secret above and encode the digest as
                  lower-case hex.
                </li>
                <li>
                  Append it as <code>sig</code>. The call is rejected (401) when the signature does
                  not match, so a tampered parameter or an unknown caller cannot count a conversion.
                </li>
              </ol>
              <p className="text-xs font-medium uppercase text-neutral-500">Worked example</p>
              <Code>{`string to sign: ${canonicalPostbackQuery(exampleParams)}
signature:      ${await signPostbackQuery(exampleParams, key.secret)}
URL:            ${exampleUrl}`}</Code>
            </div>
          </section>
        );
      }}
    </RequireOrg>
  );
}
