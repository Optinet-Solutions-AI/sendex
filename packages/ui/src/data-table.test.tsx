import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { type ColumnDef, DataTable } from "./data-table.js";

interface Row {
  name: string;
  sent: number;
}

const columns: ColumnDef<Row, unknown>[] = [
  { id: "name", header: "Name", accessorKey: "name" },
  { id: "sent", header: "Sent", accessorKey: "sent", meta: { numeric: true } },
  { id: "note", header: "Note", cell: () => "x", enableSorting: false },
];

describe("DataTable", () => {
  it("shows ⇅ on sortable headers, ↓ on the active one, and reports a sort click", async () => {
    const onSortingChange = vi.fn();
    render(
      <DataTable
        columns={columns}
        data={[{ name: "a", sent: 1200 }]}
        sorting={[{ id: "sent", desc: true }]}
        onSortingChange={onSortingChange}
      />,
    );
    expect(screen.getByRole("columnheader", { name: /Name/ })).toHaveAttribute("aria-sort", "none");
    expect(screen.getByRole("columnheader", { name: /Sent/ })).toHaveAttribute(
      "aria-sort",
      "descending",
    );
    expect(screen.getByLabelText("sorted descending")).toBeInTheDocument();
    expect(screen.getAllByLabelText("sortable")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /Note/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Name/ }));
    expect(onSortingChange).toHaveBeenCalledWith([{ id: "name", desc: false }]);
  });

  it("right-aligns numeric cells in monospace and renders skeleton rows while loading", () => {
    const { rerender } = render(<DataTable columns={columns} data={[{ name: "a", sent: 1200 }]} />);
    const cell = screen.getByText("1200");
    expect(cell.closest("td")).toHaveClass("text-right", "font-mono");
    rerender(<DataTable columns={columns} data={[]} loading />);
    expect(screen.queryByText("Nothing to show.")).not.toBeInTheDocument();
    expect(document.querySelectorAll("tbody tr").length).toBe(5);
  });
});
