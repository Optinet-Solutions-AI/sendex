import { db, listAuditActions, listAuditActors, listAuditEntries } from "@sendex/db";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@sendex/ui";
import {
  AUDIT_PAGE_SIZE,
  auditQueryString,
  parseAuditQuery,
  summariseDetails,
} from "../../../lib/audit-params";
import { AuthError, requireAction } from "../../../lib/auth";
import { dayRangeBounds } from "../../../lib/billing-params";
import { formatDateTime, formatNumber } from "../../../lib/format";
import type { SearchParams } from "../../../lib/lists-params";
import { Pagination } from "../pagination";
import { AuthErrorView } from "../require-org";

export const dynamic = "force-dynamic";

const inputClass = "h-9 rounded-md border border-neutral-300 bg-white px-3 text-sm";
const linkButton =
  "inline-flex h-9 items-center rounded-md border border-neutral-300 bg-white px-4 text-sm font-medium hover:bg-neutral-100";

/**
 * The audit log (owners only): who did what, newest first, filtered by action, actor and
 * date, with a CSV export. Details are shown as a compact `key=value` summary; the full
 * JSON is in the cell's tooltip and in the export.
 */
export default async function AuditPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  let ctx: Awaited<ReturnType<typeof requireAction>>;
  try {
    ctx = await requireAction("audit.view");
  } catch (error) {
    if (error instanceof AuthError) return <AuthErrorView error={error} />;
    throw error;
  }
  const query = parseAuditQuery(await searchParams);
  const bounds = dayRangeBounds(query.from, query.to);
  const database = db();
  const [result, actions, actors] = await Promise.all([
    listAuditEntries(database, ctx.organisationId, {
      action: query.action || undefined,
      actorUserId: query.actor || undefined,
      from: bounds.from,
      to: bounds.to,
      page: query.page,
      pageSize: AUDIT_PAGE_SIZE,
    }),
    listAuditActions(database, ctx.organisationId),
    listAuditActors(database, ctx.organisationId),
  ]);
  const exportHref = `/audit/export${auditQueryString({ ...query, page: 1 })}`;

  return (
    <section>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Audit log</h1>
          <p className="mt-1 text-sm text-neutral-600" data-testid="audit-count">
            {formatNumber(result.total)} {result.total === 1 ? "entry" : "entries"}
          </p>
        </div>
        <a href={exportHref} className={linkButton}>
          Export CSV
        </a>
      </div>

      <form method="get" action="/audit" className="mt-4 flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-neutral-600">
          Action
          <select name="action" defaultValue={query.action} className={inputClass}>
            <option value="">All actions</option>
            {actions.map((action) => (
              <option key={action} value={action}>
                {action}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-neutral-600">
          Actor
          <select name="actor" defaultValue={query.actor} className={inputClass}>
            <option value="">All actors</option>
            {actors.map((actor) => (
              <option key={actor.id} value={actor.id}>
                {actor.name ? `${actor.name} (${actor.email})` : actor.email}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-neutral-600">
          From
          <input type="date" name="from" defaultValue={query.from} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-neutral-600">
          To
          <input type="date" name="to" defaultValue={query.to} className={inputClass} />
        </label>
        <button type="submit" className={linkButton}>
          Filter
        </button>
      </form>

      <div className="mt-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Actor</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Target</TableHead>
              <TableHead>Details</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center text-neutral-500">
                  No audit entries match.
                </TableCell>
              </TableRow>
            ) : (
              result.rows.map((row) => (
                <TableRow key={row.id} data-testid={`audit-row-${row.id}`} data-action={row.action}>
                  <TableCell className="whitespace-nowrap">
                    {formatDateTime(row.createdAt)}
                  </TableCell>
                  <TableCell>
                    {row.actorEmail ? (
                      <span title={row.actorEmail}>
                        {row.actorName ?? row.actorEmail}
                        {row.actorName ? (
                          <span className="block text-xs text-neutral-500">{row.actorEmail}</span>
                        ) : null}
                      </span>
                    ) : (
                      <span className="text-neutral-500">system</span>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{row.action}</TableCell>
                  <TableCell className="max-w-xs truncate">
                    {row.targetType ? (
                      <>
                        <span className="text-neutral-500">{row.targetType} </span>
                        <span className="font-mono text-xs" title={row.targetId ?? undefined}>
                          {row.targetId ?? ""}
                        </span>
                      </>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="max-w-md">
                    <code
                      className="block truncate text-xs text-neutral-700"
                      title={row.details ? JSON.stringify(row.details) : undefined}
                    >
                      {summariseDetails(row.details)}
                    </code>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      <Pagination
        page={query.page}
        pageSize={AUDIT_PAGE_SIZE}
        total={result.total}
        href={(page) => `/audit${auditQueryString({ ...query, page })}`}
      />
    </section>
  );
}
