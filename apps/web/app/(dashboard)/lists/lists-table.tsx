"use client";

import type { ListSortKey } from "@sendex/core";
import { countriesList } from "@sendex/core";
import {
  Badge,
  Button,
  Checkbox,
  type ColumnDef,
  ConfirmDialog,
  CountPill,
  CountryMultiSelect,
  DataTable,
  Input,
  PageHeader,
  PaginationBar,
  Popover,
  PopoverContent,
  PopoverTrigger,
  type SortingState,
  Toggle,
  useToast,
} from "@sendex/ui";
import { Archive, ArchiveRestore, Download, Files, RefreshCw, Trash2, Upload } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { formatDateTime, formatNumber } from "../../../lib/format";
import { type ListsQuery, listsQueryString } from "../../../lib/lists-params";
import {
  archiveListAction,
  deleteListsAction,
  flushAllListsAction,
  flushListAction,
} from "./actions";

export interface ListTableRow {
  id: string;
  name: string;
  country: string;
  numbersCount: number;
  sent: number;
  ctr: number;
  leads: number;
  sales: number;
  spendMicro: number;
  lastSentAt: string | null;
  lastUploadAt: string | null;
  createdAt: string;
  archivedAt: string | null;
}

interface ListsTableProps {
  rows: ListTableRow[];
  total: number;
  pageSize: number;
  query: ListsQuery;
  canUpload: boolean;
  canFlush: boolean;
  canDelete: boolean;
}

const COUNTRIES = countriesList.map((c) => ({ code: c.code, name: c.name, flag: c.flag }));

/** "--" for an empty value, as the spec draws it. */
const Dash = () => <span className="text-muted">--</span>;

const eur = (micro: number) =>
  `€${(micro / 1_000_000).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * The Lists page of the spec: search, the Countries multi-select, the count pill, a table
 * with ☐, Name, Numbers, Countries, Sent, CTR, Leads, Sales, Spend, Last Sent, Last
 * Upload, Created and the row "…" menu (View, Flush, Archive, Delete); ticking rows shows
 * "n lists selected · Clear selection · Delete selected"; "1 of 6" pagination.
 */
export function ListsTable({
  rows,
  total,
  pageSize,
  query,
  canUpload,
  canFlush,
  canDelete,
}: ListsTableProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [search, setSearch] = useState(query.search);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [flushTarget, setFlushTarget] = useState<ListTableRow | null>(null);
  const [flushAllOpen, setFlushAllOpen] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [deleteTargets, setDeleteTargets] = useState<ListTableRow[]>([]);

  const navigate = (next: Partial<ListsQuery>) => {
    router.push(`/lists${listsQueryString({ ...query, page: 1, ...next })}`);
  };

  const sorting: SortingState = [{ id: query.sort, desc: query.dir === "desc" }];
  const onSortingChange = (next: SortingState) => {
    const [first] = next;
    if (!first) return;
    navigate({ sort: first.id as ListSortKey, dir: first.desc ? "desc" : "asc" });
  };

  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const someOnPage = rows.some((r) => selected.has(r.id));
  const selectedRows = rows.filter((r) => selected.has(r.id));

  function togglePage(checked: boolean) {
    const next = new Set(selected);
    for (const r of rows) {
      if (checked) next.add(r.id);
      else next.delete(r.id);
    }
    setSelected(next);
  }

  function toggleRow(id: string, checked: boolean) {
    const next = new Set(selected);
    if (checked) next.add(id);
    else next.delete(id);
    setSelected(next);
  }

  async function archive(row: ListTableRow, archived: boolean) {
    const result = await archiveListAction(row.id, archived);
    if (!result.ok) {
      toast({ title: result.error, variant: "error" });
      return;
    }
    toast({ title: `${archived ? "Archived" : "Unarchived"} ${row.name}`, variant: "success" });
    router.refresh();
  }

  const columns: ColumnDef<ListTableRow, unknown>[] = [
    {
      id: "select",
      enableSorting: false,
      meta: { className: "w-8" },
      header: () =>
        canDelete ? (
          <Checkbox
            aria-label="Select every list on this page"
            checked={allOnPage ? true : someOnPage ? "indeterminate" : false}
            onCheckedChange={(v) => togglePage(v === true)}
          />
        ) : null,
      cell: ({ row }) =>
        canDelete ? (
          <Checkbox
            aria-label={`Select ${row.original.name}`}
            checked={selected.has(row.original.id)}
            onCheckedChange={(v) => toggleRow(row.original.id, v === true)}
          />
        ) : null,
    },
    {
      id: "name",
      header: "Name",
      cell: ({ row }) => (
        <span className="inline-flex flex-wrap items-center gap-2">
          <Link href={`/lists/${row.original.id}`} className="font-medium text-ink hover:underline">
            {row.original.name}
          </Link>
          {row.original.archivedAt ? <Badge variant="secondary">Archived</Badge> : null}
        </span>
      ),
      meta: { className: "min-w-[16rem] whitespace-normal" },
    },
    {
      id: "numbersCount",
      header: "Numbers",
      cell: ({ row }) => formatNumber(row.original.numbersCount),
      meta: { numeric: true },
    },
    {
      id: "country",
      header: "Countries",
      cell: ({ row }) => <span className="font-semibold">{row.original.country}</span>,
    },
    {
      id: "sent",
      header: "Sent",
      cell: ({ row }) => (row.original.sent > 0 ? formatNumber(row.original.sent) : <Dash />),
      meta: { numeric: true },
    },
    {
      id: "ctr",
      header: "CTR",
      cell: ({ row }) =>
        row.original.sent > 0 ? `${(row.original.ctr * 100).toFixed(2)}%` : <Dash />,
      meta: { numeric: true },
    },
    {
      id: "leads",
      header: "Leads",
      cell: ({ row }) => (row.original.leads > 0 ? formatNumber(row.original.leads) : <Dash />),
      meta: { numeric: true },
    },
    {
      id: "sales",
      header: "Sales",
      cell: ({ row }) => (row.original.sales > 0 ? formatNumber(row.original.sales) : <Dash />),
      meta: { numeric: true },
    },
    {
      id: "spend",
      header: "Spend",
      cell: ({ row }) => (row.original.spendMicro > 0 ? eur(row.original.spendMicro) : <Dash />),
      meta: { numeric: true },
    },
    {
      id: "lastSentAt",
      header: "Last Sent",
      cell: ({ row }) =>
        row.original.lastSentAt ? formatDateTime(row.original.lastSentAt) : <Dash />,
    },
    {
      id: "lastUploadAt",
      header: "Last Upload",
      cell: ({ row }) =>
        row.original.lastUploadAt ? formatDateTime(row.original.lastUploadAt) : <Dash />,
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
        const archived = row.original.archivedAt !== null;
        return (
          // A portalled popover: an inline menu was cut off by the table's scroll box.
          <Popover open={open} onOpenChange={(next) => setMenuFor(next ? row.original.id : null)}>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Actions for ${row.original.name}`}
                aria-haspopup="menu"
              >
                <span aria-hidden="true">⋯</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-40 p-0 py-1">
              <div role="menu">
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
                {canUpload ? (
                  <button
                    type="button"
                    role="menuitem"
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-neutral-100"
                    onClick={() => {
                      setMenuFor(null);
                      void archive(row.original, !archived);
                    }}
                  >
                    {archived ? (
                      <>
                        <ArchiveRestore className="h-4 w-4" aria-hidden="true" /> Unarchive
                      </>
                    ) : (
                      <>
                        <Archive className="h-4 w-4" aria-hidden="true" /> Archive
                      </>
                    )}
                  </button>
                ) : null}
                {canDelete ? (
                  <button
                    type="button"
                    role="menuitem"
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-signal hover:bg-red-50"
                    onClick={() => {
                      setMenuFor(null);
                      setDeleteTargets([row.original]);
                    }}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" /> Delete
                  </button>
                ) : null}
              </div>
            </PopoverContent>
          </Popover>
        );
      },
    },
  ];

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
            <Button variant="outline" asChild>
              <Link href="/lists/files">
                <Files className="h-4 w-4" aria-hidden="true" /> Files
              </Link>
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
        <CountryMultiSelect
          countries={COUNTRIES}
          value={query.countries}
          onChange={(codes) => navigate({ countries: codes })}
          prefix="Countries:"
        />
        <Button type="submit" variant="outline">
          Search
        </Button>
        <Toggle
          label="Show archived"
          checked={query.archived}
          onCheckedChange={(next) => navigate({ archived: next })}
        />
        <CountPill count={total} noun="list" className="ml-auto" testId="lists-count" />
      </form>

      {selectedRows.length > 0 ? (
        <div
          className="mt-3 flex flex-wrap items-center gap-3 rounded-md border border-rule bg-page px-3 py-2 text-sm"
          data-testid="selection-bar"
        >
          <span className="font-medium text-ink">
            {selectedRows.length} list{selectedRows.length === 1 ? "" : "s"} selected
          </span>
          <button
            type="button"
            className="text-muted underline-offset-2 hover:underline"
            onClick={() => setSelected(new Set())}
          >
            Clear selection
          </button>
          <Button
            variant="destructive"
            size="sm"
            className="ml-auto"
            onClick={() => setDeleteTargets(selectedRows)}
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Delete selected
          </Button>
        </div>
      ) : null}

      <div className="mt-4">
        <DataTable
          columns={columns}
          data={rows}
          sorting={sorting}
          onSortingChange={onSortingChange}
          getRowId={(row) => row.id}
          rowTestId={(row) => `list-row-${row.id}`}
          rowClassName={(row) => (selected.has(row.id) ? "bg-navy-soft/60" : undefined)}
          emptyMessage={query.archived ? "No archived lists." : "No lists match."}
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

      <ConfirmDialog
        open={deleteTargets.length > 0}
        onOpenChange={(open) => {
          if (!open) setDeleteTargets([]);
        }}
        title={
          deleteTargets.length === 1
            ? `Delete "${deleteTargets[0]?.name ?? ""}"?`
            : `Delete ${deleteTargets.length} lists?`
        }
        description="The lists and their memberships are removed for good. The contacts themselves stay in your organisation. This action cannot be undone."
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          const result = await deleteListsAction(deleteTargets.map((r) => r.id));
          if (!result.ok) throw new Error(result.error);
          toast({
            title: `${result.data.deleted} list${result.data.deleted === 1 ? "" : "s"} deleted`,
            variant: "success",
          });
          setSelected(new Set());
          router.refresh();
        }}
      />
    </section>
  );
}
