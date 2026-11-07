"use client";

import { PillTabs } from "@sendex/ui";
import { usePathname, useRouter } from "next/navigation";

import type { UnsubscribeTab } from "./tab-names";

const TABS = [
  { value: "numbers", label: "Numbers" },
  { value: "imports", label: "Imported lists" },
  { value: "api", label: "Unsubscribe API" },
] as const satisfies readonly { value: UnsubscribeTab; label: string }[];

export function UnsubscribeTabs({ active }: { active: UnsubscribeTab }) {
  const router = useRouter();
  const pathname = usePathname();
  return (
    <PillTabs
      label="Unsubscribe sections"
      value={active}
      tabs={TABS}
      onChange={(tab) => router.replace(tab === "numbers" ? pathname : `${pathname}?tab=${tab}`)}
    />
  );
}
