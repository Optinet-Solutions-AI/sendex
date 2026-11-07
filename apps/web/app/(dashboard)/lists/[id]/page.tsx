import { can, countryByCode, flagEmoji } from "@sendex/core";
import { db, getList, listMembersPage } from "@sendex/db";
import {
  Badge,
  KpiStrip,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@sendex/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AuthError, requireAction } from "../../../../lib/auth";
import { formatDateTime, formatNumber } from "../../../../lib/format";
import { AuthErrorView } from "../../require-org";
import { FlushButton } from "./flush-button";

export const dynamic = "force-dynamic";

const MEMBERS_PAGE_SIZE = 50;

/**
 * List detail: counts, dates, flush and a page of members. Full numbers are shown here on
 * purpose: this is the contacts area. They are never written to logs.
 */
export default async function ListDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  let ctx: Awaited<ReturnType<typeof requireAction>>;
  try {
    ctx = await requireAction("list.view");
  } catch (error) {
    if (error instanceof AuthError) return <AuthErrorView error={error} />;
    throw error;
  }
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const list = await getList(db(), ctx.organisationId, id);
  if (!list) notFound();

  const pageRaw = Number.parseInt((await searchParams).page ?? "1", 10);
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? pageRaw : 1;
  const members = await listMembersPage(db(), ctx.organisationId, id, {
    page,
    pageSize: MEMBERS_PAGE_SIZE,
  });
  const pages = Math.max(1, Math.ceil(members.total / MEMBERS_PAGE_SIZE));
  const country = countryByCode(list.country);

  return (
    <section>
      <PageHeader
        breadcrumb={[
          { label: "Contacts" },
          { label: "Lists", href: "/lists" },
          { label: list.name },
        ]}
        title={list.name}
        meta={
          <>
            {flagEmoji(list.country)} {country?.name ?? list.country}
          </>
        }
        actions={
          can(ctx.role, "list.flush") ? <FlushButton listId={list.id} listName={list.name} /> : null
        }
      />

      <KpiStrip
        items={[
          { label: "Numbers", value: formatNumber(list.counts.members), testId: "count-members" },
          {
            label: "Available",
            value: formatNumber(list.counts.available),
            testId: "count-available",
          },
          { label: "Sent", value: formatNumber(list.counts.sent), testId: "count-sent" },
          {
            label: "Bad",
            value: formatNumber(list.counts.bad),
            testId: "count-bad",
            tone: list.counts.bad > 0 ? "bad" : "default",
          },
        ]}
      />

      <dl className="mt-4 grid gap-x-6 gap-y-1 text-sm md:grid-cols-3">
        <div>
          <dt className="text-neutral-500">Created</dt>
          <dd>{formatDateTime(list.createdAt)}</dd>
        </div>
        <div>
          <dt className="text-neutral-500">Last upload</dt>
          <dd>{formatDateTime(list.lastUploadAt)}</dd>
        </div>
        <div>
          <dt className="text-neutral-500">Last sent</dt>
          <dd>{formatDateTime(list.lastSentAt)}</dd>
        </div>
      </dl>

      <h2 className="mt-8 text-lg font-semibold">Members</h2>
      <div className="mt-2">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Number</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Sent</TableHead>
              <TableHead>Flushed</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-20 text-center text-neutral-500">
                  No members yet.
                </TableCell>
              </TableRow>
            ) : (
              members.rows.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="font-mono text-xs">{m.e164}</TableCell>
                  <TableCell>
                    {[m.firstName, m.lastName].filter(Boolean).join(" ") || "—"}
                  </TableCell>
                  <TableCell>{m.email ?? "—"}</TableCell>
                  <TableCell>
                    {m.bad ? (
                      <Badge variant="destructive" title={m.badReason ?? undefined}>
                        Bad
                      </Badge>
                    ) : m.sentAt ? (
                      <Badge variant="secondary">Sent</Badge>
                    ) : (
                      <Badge variant="success">Available</Badge>
                    )}
                  </TableCell>
                  <TableCell>{formatDateTime(m.sentAt)}</TableCell>
                  <TableCell>{formatDateTime(m.flushedAt)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      <div className="mt-3 flex items-center justify-between text-sm text-neutral-600">
        <span>
          {formatNumber(members.total)} members · page {page} of {pages}
        </span>
        <div className="flex gap-2">
          {page > 1 ? (
            <Link href={`/lists/${id}?page=${page - 1}`} className="underline">
              Previous
            </Link>
          ) : null}
          {page < pages ? (
            <Link href={`/lists/${id}?page=${page + 1}`} className="underline">
              Next
            </Link>
          ) : null}
        </div>
      </div>
    </section>
  );
}
