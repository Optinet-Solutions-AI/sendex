"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useCallback } from "react";

/** Gives a server-rendered log panel the `onChanged` callback its manager needs (a refresh). */
export function LogPanelRefresh({ children }: { children: (onChanged: () => void) => ReactNode }) {
  const router = useRouter();
  const onChanged = useCallback(() => router.refresh(), [router]);
  return <>{children(onChanged)}</>;
}
