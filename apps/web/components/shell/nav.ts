import type { Action } from "@sendex/core";

/** A leaf page in the rail. */
export interface NavLeaf {
  label: string;
  href: string;
  /** Shown only to roles that may perform this action. */
  action?: Action;
}

/** A rail entry: either a page or a group of pages (and groups), as SMS Edge's sidebar tree. */
export interface NavGroup {
  label: string;
  /** lucide icon name, resolved by the rail. */
  icon: "dashboard" | "campaigns" | "performance" | "contacts" | "routes" | "settings";
  /** Direct page for the entry itself, when it is not only a folder. */
  href?: string;
  children?: readonly (NavLeaf | NavSubgroup)[];
  /** Still in preview: shown only to organisations with the preview switched on (D5-09). */
  preview?: boolean;
}

export interface NavSubgroup {
  label: string;
  children: readonly NavLeaf[];
}

/**
 * The sidebar tree of the spec. Pages that do not exist yet are left out rather than linked
 * to a placeholder; each parity phase adds its own entries here.
 */
export const NAV_TREE: readonly NavGroup[] = [
  { label: "Dashboard", icon: "dashboard", href: "/" },
  {
    label: "Campaigns",
    icon: "campaigns",
    children: [
      { label: "Campaigns", href: "/campaigns", action: "campaign.view" },
      {
        label: "Reports",
        children: [
          { label: "Campaigns Log", href: "/reports/campaigns-log", action: "campaign.view" },
          { label: "Calendar", href: "/campaigns/scheduled", action: "campaign.view" },
          { label: "Postback Logs", href: "/reports/postbacks", action: "campaign.view" },
        ],
      },
    ],
  },
  {
    // The KPI screens (D5-03 onwards), after the Business KPIs Manager walkthrough.
    label: "Performance",
    icon: "performance",
    preview: true,
    children: [
      { label: "Insight", href: "/kpi/insight", action: "campaign.view" },
      { label: "Sales Results", href: "/kpi/sales-results", action: "campaign.view" },
      { label: "Trends", href: "/kpi/trends", action: "campaign.view" },
      { label: "List Follow-Up", href: "/kpi/list-follow-up", action: "campaign.view" },
      { label: "Daily Plan", href: "/kpi/daily-plan", action: "campaign.view" },
    ],
  },
  {
    label: "Contacts",
    icon: "contacts",
    children: [
      { label: "Lists", href: "/lists", action: "list.view" },
      { label: "Segments", href: "/segments", action: "list.view" },
      { label: "Enrichment", href: "/enrichment", action: "list.view" },
      { label: "Unsubscribe", href: "/unsubscribes", action: "list.view" },
    ],
  },
  {
    label: "Routes",
    icon: "routes",
    children: [
      { label: "Platform Routes", href: "/routes/platform", action: "route.view" },
      { label: "Custom Routes", href: "/routes/custom", action: "route.view" },
      { label: "Testing", href: "/routes/testing", action: "route.view" },
      { label: "Mobile Networks", href: "/routes/mobile-networks", action: "route.view" },
    ],
  },
  {
    label: "Settings",
    icon: "settings",
    children: [
      { label: "General", href: "/settings", action: "settings.view" },
      { label: "Billing", href: "/billing" },
      { label: "API tokens", href: "/settings/api-tokens", action: "settings.view" },
      { label: "Postbacks", href: "/settings/postbacks", action: "settings.view" },
      { label: "Emergency stop", href: "/settings/emergency-stop", action: "settings.view" },
      { label: "Logs", href: "/audit", action: "audit.view" },
    ],
  },
];

export function isSubgroup(entry: NavLeaf | NavSubgroup): entry is NavSubgroup {
  return "children" in entry;
}

/** Every page in the tree with its path of labels, for the search palette. */
export interface NavPage {
  label: string;
  href: string;
  path: string[];
  action?: Action;
}

export function flattenNav(tree: readonly NavGroup[] = NAV_TREE): NavPage[] {
  const pages: NavPage[] = [];
  for (const group of tree) {
    if (group.href) pages.push({ label: group.label, href: group.href, path: [] });
    for (const entry of group.children ?? []) {
      if (isSubgroup(entry)) {
        for (const leaf of entry.children) {
          pages.push({
            label: leaf.label,
            href: leaf.href,
            path: [group.label, entry.label],
            ...(leaf.action ? { action: leaf.action } : {}),
          });
        }
      } else {
        pages.push({
          label: entry.label,
          href: entry.href,
          path: [group.label],
          ...(entry.action ? { action: entry.action } : {}),
        });
      }
    }
  }
  return pages;
}

/** Longest-prefix match: `/campaigns/abc` belongs to Campaigns › Campaigns, `/` only to Dashboard. */
export function activeHref(pathname: string, tree: readonly NavGroup[] = NAV_TREE): string | null {
  let best: string | null = null;
  for (const page of flattenNav(tree)) {
    const matches =
      page.href === "/"
        ? pathname === "/"
        : pathname === page.href || pathname.startsWith(`${page.href}/`);
    if (matches && (best === null || page.href.length > best.length)) best = page.href;
  }
  return best;
}

/** The top-level group that owns the active page, so the rail can expand it. */
export function activeGroup(pathname: string, tree: readonly NavGroup[] = NAV_TREE): string | null {
  const href = activeHref(pathname, tree);
  if (href === null) return null;
  for (const group of tree) {
    if (group.href === href) return group.label;
    for (const entry of group.children ?? []) {
      if (isSubgroup(entry)) {
        if (entry.children.some((l) => l.href === href)) return group.label;
      } else if (entry.href === href) {
        return group.label;
      }
    }
  }
  return null;
}

/**
 * Filter the tree to what a role may see; groups left without pages disappear. Groups still in
 * preview are dropped unless `options.preview` is true (the default keeps them, so only the
 * shell, which knows the organisation, has to say).
 */
export function visibleNav(
  can: (action: Action) => boolean,
  tree: readonly NavGroup[] = NAV_TREE,
  options: { preview?: boolean } = {},
): NavGroup[] {
  const allowed = (leaf: NavLeaf) => !leaf.action || can(leaf.action);
  const showPreview = options.preview ?? true;
  const out: NavGroup[] = [];
  for (const group of tree) {
    if (group.preview && !showPreview) continue;
    if (!group.children) {
      out.push(group);
      continue;
    }
    const children: (NavLeaf | NavSubgroup)[] = [];
    for (const entry of group.children) {
      if (isSubgroup(entry)) {
        const leaves = entry.children.filter(allowed);
        if (leaves.length > 0) children.push({ label: entry.label, children: leaves });
      } else if (allowed(entry)) {
        children.push(entry);
      }
    }
    if (children.length > 0) out.push({ ...group, children });
  }
  return out;
}
