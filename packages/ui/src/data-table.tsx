"use client";

import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "./cn.js";
import { SkeletonRows } from "./skeleton.js";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./table.js";

export type { ColumnDef, SortingState };

/** Per-column presentation hints read from `column.meta`. */
export interface ColumnMeta {
  className?: string;
  /** Right-aligned monospace cell, as every number in the spec. */
  numeric?: boolean;
  /** Header alignment follows the cell. */
  align?: "left" | "right" | "center";
}

export interface DataTableProps<TData> {
  columns: ColumnDef<TData, unknown>[];
  data: TData[];
  /** Server-side sorting: the current state and what to do when a header is clicked. */
  sorting?: SortingState;
  onSortingChange?: (sorting: SortingState) => void;
  emptyMessage?: ReactNode;
  /** Grey skeleton rows instead of the body. */
  loading?: boolean;
  getRowId?: (row: TData) => string;
  rowTestId?: (row: TData) => string;
  /** Highlight rows, e.g. a bulk selection. */
  rowClassName?: (row: TData) => string | undefined;
  className?: string;
}

function metaOf(column: { columnDef: { meta?: unknown } }): ColumnMeta {
  return (column.columnDef.meta ?? {}) as ColumnMeta;
}

/**
 * Thin table on TanStack Table: renders `columns` over `data` with the spec's sortable
 * headers (⇅ when sortable, ↓ or ↑ when active), right-aligned monospace numbers via
 * `meta.numeric`, skeleton rows while loading and a sideways scroll on narrow screens.
 * Sorting is manual (the caller re-queries), so it works with server-paged data.
 */
export function DataTable<TData>({
  columns,
  data,
  sorting = [],
  onSortingChange,
  emptyMessage = "Nothing to show.",
  loading = false,
  getRowId,
  rowTestId,
  rowClassName,
  className,
}: DataTableProps<TData>) {
  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    manualSorting: true,
    enableSortingRemoval: false,
    onSortingChange: (updater) => {
      if (!onSortingChange) return;
      onSortingChange(typeof updater === "function" ? updater(sorting) : updater);
    },
    getCoreRowModel: getCoreRowModel(),
    ...(getRowId ? { getRowId } : {}),
  });

  return (
    <Table className={className}>
      <TableHeader>
        {table.getHeaderGroups().map((group) => (
          <TableRow key={group.id}>
            {group.headers.map((header) => {
              const meta = metaOf(header.column);
              const canSort = Boolean(onSortingChange) && header.column.getCanSort();
              const sorted = header.column.getIsSorted();
              const label = header.isPlaceholder
                ? null
                : flexRender(header.column.columnDef.header, header.getContext());
              const align = meta.align ?? (meta.numeric ? "right" : "left");
              return (
                <TableHead
                  key={header.id}
                  aria-sort={ariaSort(sorted)}
                  className={cn(
                    align === "right" && "text-right",
                    align === "center" && "text-center",
                    meta.className,
                  )}
                >
                  {canSort ? (
                    <button
                      type="button"
                      className={cn(
                        "inline-flex items-center gap-1 uppercase hover:text-ink",
                        sorted && "text-ink",
                      )}
                      onClick={header.column.getToggleSortingHandler()}
                    >
                      {label}
                      {sorted === "asc" ? (
                        <ArrowUp className="h-3 w-3" aria-label="sorted ascending" />
                      ) : sorted === "desc" ? (
                        <ArrowDown className="h-3 w-3" aria-label="sorted descending" />
                      ) : (
                        <ArrowUpDown className="h-3 w-3 opacity-60" aria-label="sortable" />
                      )}
                    </button>
                  ) : (
                    label
                  )}
                </TableHead>
              );
            })}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {loading ? (
          <SkeletonRows rows={5} columns={columns.length} />
        ) : table.getRowModel().rows.length === 0 ? (
          <TableRow>
            <TableCell colSpan={columns.length} className="py-10 text-center text-muted">
              {emptyMessage}
            </TableCell>
          </TableRow>
        ) : (
          table.getRowModel().rows.map((row) => (
            <TableRow
              key={row.id}
              data-testid={rowTestId?.(row.original)}
              className={rowClassName?.(row.original)}
            >
              {row.getVisibleCells().map((cell) => {
                const meta = metaOf(cell.column);
                return (
                  <TableCell
                    key={cell.id}
                    className={cn(
                      meta.numeric && "text-right font-mono tabular-nums",
                      meta.align === "center" && "text-center",
                      meta.className,
                    )}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                );
              })}
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}

function ariaSort(sorted: false | "asc" | "desc"): "ascending" | "descending" | "none" {
  if (sorted === "asc") return "ascending";
  if (sorted === "desc") return "descending";
  return "none";
}
