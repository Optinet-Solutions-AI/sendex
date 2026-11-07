"use client";

import { UnderlineTabs } from "@sendex/ui";
import { usePathname, useRouter } from "next/navigation";

import type { ListTab } from "./tabs";

const TABS = [
  { value: "contacts", label: "Contacts" },
  { value: "analytics", label: "Analytics" },
  { value: "files", label: "Data Files" },
  { value: "campaigns", label: "Campaigns" },
  { value: "lookup", label: "Lookup" },
] as const satisfies readonly { value: ListTab; label: string }[];

/** The five underline tabs of list details; the active one lives in `?tab=`. */
export function ListTabs({ active }: { active: ListTab }) {
  const router = useRouter();
  const pathname = usePathname();
  return (
    <UnderlineTabs
      label="List sections"
      value={active}
      tabs={TABS}
      onChange={(tab) => router.replace(tab === "contacts" ? pathname : `${pathname}?tab=${tab}`)}
    />
  );
}
