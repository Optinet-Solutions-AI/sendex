import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DateRangePicker, describeRange, presetRange } from "./date-range-picker.js";

const TODAY = new Date("2026-11-07T15:00:00Z");

describe("presetRange", () => {
  it("counts the presets back from today in UTC days, inclusive", () => {
    expect(presetRange("today", TODAY)).toEqual({ from: "2026-11-07", to: "2026-11-07" });
    expect(presetRange("yesterday", TODAY)).toEqual({ from: "2026-11-06", to: "2026-11-06" });
    expect(presetRange("last7", TODAY)).toEqual({ from: "2026-11-01", to: "2026-11-07" });
    expect(presetRange("last30", TODAY)).toEqual({ from: "2026-10-09", to: "2026-11-07" });
    expect(presetRange("last90", TODAY)).toEqual({ from: "2026-08-10", to: "2026-11-07" });
  });
});

describe("describeRange", () => {
  it("reads Date Range when empty, one day, or a from – to span", () => {
    expect(describeRange({ from: "", to: "" })).toBe("Date Range");
    expect(describeRange({ from: "2026-11-07", to: "2026-11-07" })).toBe("7 Nov 2026");
    expect(describeRange({ from: "2026-11-01", to: "2026-11-07" })).toBe("1 Nov 2026 – 7 Nov 2026");
    expect(describeRange({ from: "2026-11-01", to: "" })).toBe("From 1 Nov 2026");
  });
});

describe("DateRangePicker", () => {
  it("opens the presets and applies Last 7 Days", () => {
    const onChange = vi.fn();
    render(<DateRangePicker value={{ from: "", to: "" }} onChange={onChange} today={TODAY} />);
    fireEvent.click(screen.getByRole("button", { name: "Date Range" }));
    fireEvent.click(screen.getByRole("button", { name: "Last 7 Days" }));
    expect(onChange).toHaveBeenCalledWith({ from: "2026-11-01", to: "2026-11-07" });
  });
});
