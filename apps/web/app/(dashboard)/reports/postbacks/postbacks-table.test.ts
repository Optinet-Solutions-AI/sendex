import { describe, expect, it } from "vitest";
import { splitReceived, summariseParams, timingLabel } from "./postbacks-table";

describe("summariseParams", () => {
  it("lists the extra parameters and leaves type and dynamic_id out", () => {
    expect(summariseParams({ type: "lead", dynamic_id: "abc", sub_id: "e2e", v: 1 })).toBe(
      "sub_id=e2e v=1",
    );
    expect(summariseParams({ type: "sale" })).toBe("");
    // SMS Edge's `key` is the dynamic id too.
    expect(summariseParams({ type: "lead", key: "abc", sub_id: "x" })).toBe("sub_id=x");
  });
});

describe("timingLabel", () => {
  it("says same day, or how many days later", () => {
    expect(timingLabel("same_day", 0)).toBe("Same day");
    expect(timingLabel("late", 1)).toBe("Late · 1 day");
    expect(timingLabel("late", 14)).toBe("Late · 14 days");
    expect(timingLabel(null, null)).toBe("");
  });
});

describe("splitReceived", () => {
  it("renders the UTC date and time of the spec", () => {
    expect(splitReceived("2026-11-07T08:15:18.000Z")).toEqual({
      date: "2026-11-07",
      time: "08:15:18",
    });
    expect(splitReceived("nope")).toEqual({ date: "—", time: "" });
  });
});
