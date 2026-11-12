import { describe, expect, it } from "vitest";
import { campaignStatusLabel } from "./status";

// Decisions item 35 (2026-11-12): every status gets its own label instead of Active / Done.
describe("campaignStatusLabel", () => {
  it("names each status on its own", () => {
    expect(campaignStatusLabel("draft")).toEqual({ label: "Draft", variant: "secondary" });
    expect(campaignStatusLabel("scheduled")).toEqual({ label: "Scheduled", variant: "outline" });
    expect(campaignStatusLabel("sending")).toEqual({ label: "Sending", variant: "active" });
    expect(campaignStatusLabel("paused")).toEqual({ label: "Paused", variant: "warning" });
    expect(campaignStatusLabel("stopped")).toEqual({ label: "Stopped", variant: "destructive" });
    expect(campaignStatusLabel("completed")).toEqual({ label: "Completed", variant: "success" });
  });
});
