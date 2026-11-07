import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import {
  axisTick,
  CHART_OTHER,
  CHART_SERIES,
  ChartFrame,
  ChartTable,
  ChartTooltipContent,
  sequentialColor,
  seriesColor,
} from "./charts.js";

describe("chart helpers", () => {
  it("assigns series colours by slot, grey for Other, and wraps past eight", () => {
    expect(seriesColor(0)).toBe(CHART_SERIES[0]);
    expect(seriesColor(7)).toBe(CHART_SERIES[7]);
    expect(seriesColor(8)).toBe(CHART_SERIES[0]);
    expect(seriesColor(2, "Other")).toBe(CHART_OTHER);
  });

  it("steps the sequential ramp from light to dark", () => {
    expect(sequentialColor(0, 0, 100)).toBe("#cde2fb");
    expect(sequentialColor(100, 0, 100)).toBe("#0d366b");
    expect(sequentialColor(5, 5, 5)).toBe("#3987e5");
  });

  it("formats axis ticks compactly", () => {
    expect(axisTick(950)).toBe("950");
    expect(axisTick(12_000)).toBe("12K");
    expect(axisTick(1_250_000)).toBe("1.3M");
  });
});

describe("ChartTooltipContent", () => {
  it("lists every series with the value first", () => {
    render(
      <ChartTooltipContent
        active
        label="2026-11"
        payload={[
          { name: "Spain", value: 1200, color: "#2a78d6", dataKey: "ES" },
          { name: "Other", value: 30, color: "#898781", dataKey: "Other" },
        ]}
      />,
    );
    expect(screen.getByText("2026-11")).toBeInTheDocument();
    expect(screen.getByText("1,200")).toBeInTheDocument();
    expect(screen.getByText("Spain")).toBeInTheDocument();
    expect(screen.getByText("30")).toBeInTheDocument();
  });

  it("renders nothing while inactive", () => {
    const { container } = render(<ChartTooltipContent active={false} payload={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("ChartFrame", () => {
  it("switches between the chart and its table twin", async () => {
    render(
      <ChartFrame
        title="SMS sent"
        table={<ChartTable columns={["Month", "Sent"]} rows={[["2026-11", "1,200"]]} />}
      >
        <div data-testid="plot">plot</div>
      </ChartFrame>,
    );
    expect(screen.getByTestId("plot")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Table" }));
    expect(screen.queryByTestId("plot")).not.toBeInTheDocument();
    expect(screen.getByText("1,200")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Chart" }));
    expect(screen.getByTestId("plot")).toBeInTheDocument();
  });

  it("shows the empty state instead of the plot", () => {
    render(
      <ChartFrame title="SMS sent" empty emptyText="No API traffic">
        <div data-testid="plot">plot</div>
      </ChartFrame>,
    );
    expect(screen.getByText("No API traffic")).toBeInTheDocument();
    expect(screen.queryByTestId("plot")).not.toBeInTheDocument();
  });
});
