import { describe, expect, it } from "vitest";
import { timeAgo } from "./format";

describe("timeAgo", () => {
  const now = new Date("2026-11-07T12:00:00Z");
  it("reads like the spec's Last sent column", () => {
    expect(timeAgo("2026-11-07T11:59:50Z", now)).toBe("just now");
    expect(timeAgo("2026-11-07T11:30:00Z", now)).toBe("30 minutes ago");
    expect(timeAgo("2026-11-06T23:00:00Z", now)).toBe("13 hours ago");
    expect(timeAgo("2026-11-04T12:00:00Z", now)).toBe("3 days ago");
    expect(timeAgo("2026-11-06T12:00:00Z", now)).toBe("1 day ago");
    expect(timeAgo("2026-07-07T12:00:00Z", now)).toBe("4 months ago");
    expect(timeAgo("2024-07-07T12:00:00Z", now)).toBe("2 years ago");
    expect(timeAgo(null, now)).toBe("—");
  });
});
