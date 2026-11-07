import { describe, expect, it } from "vitest";
import { activeGroup, activeHref, flattenNav, NAV_TREE, visibleNav } from "./nav";

describe("nav tree", () => {
  it("flattens every page with its path of labels", () => {
    const pages = flattenNav();
    expect(pages.find((p) => p.href === "/")).toEqual({ label: "Dashboard", href: "/", path: [] });
    expect(pages.find((p) => p.href === "/reports/postbacks")).toMatchObject({
      label: "Postback Logs",
      path: ["Campaigns", "Reports"],
    });
    expect(pages.find((p) => p.href === "/audit")).toMatchObject({ action: "audit.view" });
  });

  it("resolves the active page by the longest prefix and its top-level group", () => {
    expect(activeHref("/")).toBe("/");
    expect(activeHref("/campaigns")).toBe("/campaigns");
    expect(activeHref("/campaigns/abc-123")).toBe("/campaigns");
    expect(activeHref("/campaigns/scheduled")).toBe("/campaigns/scheduled");
    expect(activeHref("/settings/api-tokens")).toBe("/settings/api-tokens");
    expect(activeHref("/nowhere")).toBeNull();
    expect(activeGroup("/lists/upload")).toBe("Contacts");
    expect(activeGroup("/reports/postbacks")).toBe("Campaigns");
    expect(activeGroup("/")).toBe("Dashboard");
    expect(activeGroup("/nowhere")).toBeNull();
  });

  it("hides pages a role may not open and drops emptied groups", () => {
    const viewerOnly = visibleNav((action) => action === "campaign.view" || action === "list.view");
    const labels = viewerOnly.map((g) => g.label);
    expect(labels).toEqual(["Dashboard", "Campaigns", "Contacts", "Settings"]);
    const settings = viewerOnly.find((g) => g.label === "Settings");
    expect(settings?.children?.map((c) => c.label)).toEqual(["Billing"]);
    const everything = visibleNav(() => true);
    expect(everything).toEqual(NAV_TREE);
  });
});
