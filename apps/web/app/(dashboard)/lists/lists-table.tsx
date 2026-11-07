"use client";

import type { ListSortKey } from "@sendex/core";
import { countriesList, countryByCode, flagEmoji } from "@sendex/core";
import {
  Button,
  type ColumnDef,
  ConfirmDialog,
  CountPill,
  DataTable,
  Input,
  PageHeader,
  PaginationBar,
  SimpleSelect,
  type SortingState,
  useToast,
} from "@sendex/ui";
import { Download, RefreshCw, Upload } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useMemo, useState } from "react";
import { formatDateTime, formatNumber } from "../../../lib/format";
import { type ListsQuery, listsQueryString } from "../../../lib/lists-params";
import { flushAllListsAction, flushListAction } from "./actions";

export interface ListTableRow {
  id: string;
  name: string;
  country: string;
  numbersCount: number;
  sent: number;
  lastSentAt: string | null;
  lastUploadAt: string | null;
  createdAt: string;
}

interface ListsTableProps {
  rows: ListTableRow[];
  total: number;
  pageSize: number;
  query: ListsQuery;
  canUpload: boolean;
  canFlush: boolean;
}

const ALL_COUNTRIES = "all";

const countryOptions = [
  { value: ALL_COUNTRIES, label: "All countries" },
  ...countriesList.map((c) => ({ value: c.code, label: `${c.flag} ${c.name}` })),
];

/** Placeholder until the campaign engine reports per-list stats. TODO(D2-13): CTR, leads, sales, spend. */
const Dash = () => <span className="text-neutral-400">—</span>;

export function ListsTable({ rows, total, pageSize, query, canUpload, canFlush }: ListsTableProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [search, setSearch] = useState(query.search);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [flushTarget, setFlushTarget] = useState<ListTableRow | null>(null);
  const [flushAllOpen, setFlushAllOpen] = useState(false);

  const navigate = (next: Partial<ListsQuery>) => {
    router.push(`/lists${listsQueryString({ ...query, page: 1, ...next })}`);
  };

  const sorting: SortingState = [{ id: query.sort, desc: query.dir === "desc" }];
  const onSortingChange = (next: SortingState) => {
    const [first] = next;
    if (!first) return;
    navigate({ sort: first.id as ListSortKey, dir: first.desc ? "desc" : "asc" });
  };

  const columns = useMemo<ColumnDef<ListTableRow, unknown>[]>(
    () => [
      {
        id: "name",
        header: "Name",
        cell: ({ row }) => (
          <Link href={`/lists/${row.original.id}`} className="font-medium hover:underline">
            {row.original.name}
          </Link>
        ),
      },
      {
        id: "numbersCount",
        header: "Numbers",
        cell: ({ row }) => formatNumber(row.original.numbersCount),
        meta: { className: "text-right tabular-nums" },
      },
      {
        id: "country",
        header: "Country",
        cell: ({ row }) => (
          <span title={countryByCode(row.original.country)?.name ?? row.original.country}>
            {flagEmoji(row.original.country)} {row.original.country}
          </span>
        ),
      },
      {
        id: "sent",
        header: "Sent",
        cell: ({ row }) => formatNumber(row.original.sent),
        meta: { className: "text-right tabular-nums" },
      },
      { id: "ctr", header: "CTR", cell: () => <Dash />, enableSorting: false },
      { id: "leads", header: "Leads", cell: () => <Dash />, enableSorting: false },
      { id: "sales", header: "Sales", cell: () => <Dash />, enableSorting: false },
      { id: "spend", header: "Spend", cell: () => <Dash />, enableSorting: false },
      {
        id: "lastSentAt",
        header: "Last sent",
        cell: ({ row }) => formatDateTime(row.original.lastSentAt),
      },
      {
        id: "lastUploadAt",
        header: "Last upload",
        cell: ({ row }) => formatDateTime(row.original.lastUploadAt),
      },
      {
        id: "createdAt",
        header: "Created",
        cell: ({ row }) => formatDateTime(row.original.createdAt),
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        meta: { className: "w-10 text-right" },
        cell: ({ row }) => {
          const open = menuFor === row.original.id;
          return (
            <div className="relative inline-block text-left">
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Actions for ${row.original.name}`}
                aria-haspopup="menu"
                aria-expanded={open}
                onClick={() => setMenuFor(open ? null : row.original.id)}
              >
                <span aria-hidden="true">⋯</span>
              </Button>
              {open ? (
                <>
                  <button
                    type="button"
                    aria-label="Close menu"
                    className="fixed inset-0 z-10 cursor-default"
                    onClick={() => setMenuFor(null)}
                  />
                  <div
                    role="menu"
                    className="absolute right-0 z-20 mt-1 w-36 rounded-md border border-neutral-200 bg-white py-1 text-sm shadow-md"
                  >
                    <Link
                      role="menuitem"
                      href={`/lists/${row.original.id}`}
                      className="block px-3 py-1.5 hover:bg-neutral-100"
                      onClick={() => setMenuFor(null)}
                    >
                      View
                    </Link>
                    {canFlush ? (
                      <button
                        type="button"
                        role="menuitem"
                        className="block w-full px-3 py-1.5 text-left hover:bg-neutral-100"
                        onClick={() => {
                          setMenuFor(null);
                          setFlushTarget(row.original);
                        }}
                      >
                        Flush
                      </button>
                    ) : null}
                  </div>
                </>
              ) : null}
            </div>
          );
        },
      },
    ],
    [menuFor, canFlush],
  );

  const onSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    navigate({ search: search.trim() });
  };

  return (
    <section>
      <PageHeader
        breadcrumb={[{ label: "Contacts" }, { label: "Lists" }]}
        title="Lists"
        actions={
          <>
            <Button variant="outline" asChild>
              <a href={`/lists/export${listsQueryString(query)}`}>
                <Download className="h-4 w-4" aria-hidden="true" /> Export CSV
              </a>
            </Button>
            {canFlush ? (
              <Button variant="outline" onClick={() => setFlushAllOpen(true)}>
                <RefreshCw className="h-4 w-4" aria-hidden="true" /> Flush All Lists
              </Button>
            ) : null}
            {canUpload ? (
              <Button asChild>
                <Link href="/lists/upload">
                  <Upload className="h-4 w-4" aria-hidden="true" /> Upload List
                </Link>
              </Button>
            ) : null}
          </>
        }
      />

      <form onSubmit={onSearch} className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          name="search"
          placeholder="Search lists…"
          aria-label="Search lists"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-64"
        />
        <SimpleSelect
          aria-label="Country"
          className="w-52"
          value={query.country || ALL_COUNTRIES}
          onValueChange={(value) => navigate({ country: value === ALL_COUNTRIES ? "" : value })}
          options={countryOptions}
        />
        <Button type="submit" variant="outline">
          Search
        </Button>
        <CountPill count={total} noun="list" className="ml-auto" testId="lists-count" />
      </form>

      <div className="mt-4">
        <DataTable
          columns={columns}
          data={rows}
          sorting={sorting}
          onSortingChange={onSortingChange}
          getRowId={(row) => row.id}
          rowTestId={(row) => `list-row-${row.id}`}
          emptyMessage="No lists match."
        />
      </div>

      <PaginationBar
        className="mt-3"
        page={query.page}
        pageSize={pageSize}
        total={total}
        style="short"
        onPageChange={(next) => navigate({ page: next })}
      />

      <ConfirmDialog
        open={flushTarget !== null}
        onOpenChange={(open) => {
          if (!open) setFlushTarget(null);
        }}
        title={`Flush ${flushTarget?.name ?? "list"}?`}
        description="Every number in this list becomes available to send again. Bad numbers stay marked bad."
        confirmLabel="Flush list"
        destructive
        onConfirm={async () => {
          if (!flushTarget) return;
          const result = await flushListAction(flushTarget.id);
          if (!result.ok) throw new Error(result.error);
          toast({
            title: `Flushed ${flushTarget.name}`,
            description: `${formatNumber(result.data.members)} numbers reset.`,
            variant: "success",
          });
          router.refresh();
        }}
      />

      <ConfirmDialog
        open={flushAllOpen}
        onOpenChange={setFlushAllOpen}
        title="Flush all lists?"
        description="Every number in every list becomes available to send again."
        confirmLabel="Flush all lists"
        destructive
        onConfirm={async () => {
          const result = await flushAllListsAction();
          if (!result.ok) throw new Error(result.error);
          toast({
            title: "Flushed all lists",
            description: `${formatNumber(result.data.lists)} lists, ${formatNumber(result.data.members)} numbers reset.`,
            variant: "success",
          });
          router.refresh();
        }}
      />
    </section>
  );
}
