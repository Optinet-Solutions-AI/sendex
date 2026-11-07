import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CountPill } from "./count-pill.js";
import { EmptyState } from "./empty-state.js";
import { KpiStrip } from "./kpi-strip.js";
import { Breadcrumb, PageHeader } from "./page-header.js";
import { SegmentedControl } from "./segmented.js";
import { PillTabs, UnderlineTabs } from "./tabs.js";
import { Toggle } from "./toggle.js";

describe("PageHeader", () => {
  it("renders the breadcrumb in order, the title, subtitle and actions", () => {
    render(
      <PageHeader
        breadcrumb={[
          { label: "Campaigns", href: "/campaigns" },
          { label: "Reports" },
          { label: "Campaigns Log" },
        ]}
        title="Campaigns Log"
        subtitle="Daily sending broken down by campaign, country, list and route."
        actions={<button type="button">Export CSV</button>}
      />,
    );
    const crumbs = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(crumbs).toHaveTextContent("Campaigns›Reports›Campaigns Log");
    expect(screen.getByRole("link", { name: "Campaigns" })).toHaveAttribute("href", "/campaigns");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Campaigns Log");
    expect(screen.getByText(/Daily sending/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export CSV" })).toBeInTheDocument();
  });

  it("marks the last crumb as the current page", () => {
    render(<Breadcrumb items={[{ label: "SMS" }, { label: "Dashboard" }]} />);
    expect(screen.getByText("Dashboard")).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("SMS")).not.toHaveAttribute("aria-current");
  });
});

describe("KpiStrip", () => {
  it("renders one cell per metric with its label", () => {
    render(
      <KpiStrip
        items={[
          { label: "Sent", value: "46,930" },
          { label: "CTR", value: "2.03%", testId: "kpi-ctr" },
        ]}
      />,
    );
    const strip = screen.getByRole("group", { name: "Key figures" });
    expect(strip).toHaveTextContent("Sent");
    expect(screen.getByTestId("kpi-ctr")).toHaveTextContent("2.03%");
  });
});

describe("SegmentedControl", () => {
  it("shows the active option pressed and reports a click", async () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        label="Period"
        value="7d"
        options={[
          { value: "today", label: "Today" },
          { value: "7d", label: "7d" },
          { value: "30d", label: "30d" },
        ]}
        onChange={onChange}
      />,
    );
    expect(screen.getByRole("button", { name: "7d" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "30d" })).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(screen.getByRole("button", { name: "30d" }));
    expect(onChange).toHaveBeenCalledWith("30d");
  });
});

describe("Toggle", () => {
  it("is a switch that flips on click and shows its hint", async () => {
    const onChange = vi.fn();
    render(
      <Toggle
        label="Send Now"
        hint="sends immediately"
        checked={false}
        onCheckedChange={onChange}
      />,
    );
    const sw = screen.getByRole("switch", { name: "Send Now" });
    expect(sw).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText("sends immediately")).toBeInTheDocument();
    await userEvent.click(sw);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe("EmptyState", () => {
  it("renders a title and a hint line", () => {
    render(
      <EmptyState title="No campaigns yet" hint="Create your first campaign to start sending" />,
    );
    expect(screen.getByText("No campaigns yet")).toBeInTheDocument();
    expect(screen.getByText(/Create your first campaign/)).toBeInTheDocument();
  });
});

describe("tabs", () => {
  it("pill tabs select on click and expose the active one", async () => {
    const onChange = vi.fn();
    render(
      <PillTabs
        label="Campaign sections"
        value="status"
        tabs={[
          { value: "status", label: "Status" },
          { value: "logs", label: "Logs" },
        ]}
        onChange={onChange}
      />,
    );
    expect(screen.getByRole("tab", { name: "Status" })).toHaveAttribute("aria-selected", "true");
    await userEvent.click(screen.getByRole("tab", { name: "Logs" }));
    expect(onChange).toHaveBeenCalledWith("logs");
  });

  it("underline tabs can carry counts", () => {
    render(
      <UnderlineTabs
        label="Segments"
        value="all"
        tabs={[
          { value: "all", label: "All", count: 2 },
          { value: "templates", label: "Templates", count: 0 },
        ]}
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole("tab", { name: /All/ })).toHaveTextContent(/All\s*\(2\)/);
  });
});

describe("CountPill", () => {
  it("pluralises with thousands separators", () => {
    const { rerender } = render(<CountPill count={1} noun="campaign" />);
    expect(screen.getByText("1 campaign")).toBeInTheDocument();
    rerender(<CountPill count={4339} noun="contact" />);
    expect(screen.getByText("4,339 contacts")).toBeInTheDocument();
    rerender(<CountPill count={2} noun="entry" plural="entries" />);
    expect(screen.getByText("2 entries")).toBeInTheDocument();
  });
});
