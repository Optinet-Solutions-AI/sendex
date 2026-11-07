import { describe, expect, it } from "vitest";
import { splitReceived, summariseParams } from "./postbacks-table";

describe("summariseParams", () => {
  it("lists the extra parameters and leaves type and dynamic_id out", () => {
    expect(summariseParams({ type: "lead", dynamic_id: "abc", sub_id: "e2e", v: 1 })).toBe(
      "sub_id=e2e v=1",
    );
    expect(summariseParams({ type: "sale" })).toBe("");
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
