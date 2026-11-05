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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./table.js";

export type { ColumnDef, SortingState };

export interface DataTableProps<TData> {
  columns: ColumnDef<TData, unknown>[];
  data: TData[];
  /** Server-side sorting: the current state and what to do when a header is clicked. */
  sorting?: SortingState;
  onSortingChange?: (sorting: SortingState) => void;
  emptyMessage?: ReactNode;
  getRowId?: (row: TData) => string;
  rowTestId?: (row: TData) => string;
  className?: string;
}

/**
 * Thin table on TanStack Table: renders `columns` over `data` with optional sortable headers.
 * Sorting is manual (the caller re-queries), so it works with server-paged data.
 */
export function DataTable<TData>({
  columns,
  data,
  sorting = [],
  onSortingChange,
  emptyMessage = "Nothing to show.",
  getRowId,
  rowTestId,
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
              const canSort = Boolean(onSortingChange) && header.column.getCanSort();
              const sorted = header.column.getIsSorted();
              const label = header.isPlaceholder
                ? null
                : flexRender(header.column.columnDef.header, header.getContext());
              return (
                <TableHead key={header.id} aria-sort={ariaSort(sorted)}>
                  {canSort ? (
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 uppercase hover:text-neutral-900"
                      onClick={header.column.getToggleSortingHandler()}
                    >
                      {label}
                      {sorted === "asc" ? (
                        <ArrowUp className="h-3 w-3" />
                      ) : sorted === "desc" ? (
                        <ArrowDown className="h-3 w-3" />
                      ) : (
                        <ArrowUpDown className="h-3 w-3 opacity-50" />
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
        {table.getRowModel().rows.length === 0 ? (
          <TableRow>
            <TableCell colSpan={columns.length} className="h-24 text-center text-neutral-500">
              {emptyMessage}
            </TableCell>
          </TableRow>
        ) : (
          table.getRowModel().rows.map((row) => (
            <TableRow key={row.id} data-testid={rowTestId?.(row.original)}>
              {row.getVisibleCells().map((cell) => (
                <TableCell key={cell.id} className={cn(cell.column.columnDef.meta?.className)}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
              ))}
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

declare module "@tanstack/react-table" {
  interface ColumnMeta<TData, TValue> {
    className?: string;
  }
}
