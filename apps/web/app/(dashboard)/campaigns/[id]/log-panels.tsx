"use client";

import { useRouter } from "next/navigation";
import type { ComponentProps } from "react";
import { AdTextsPanel } from "../../../../components/campaigns/ad-texts-panel";
import { OffersPanel } from "../../../../components/campaigns/offers-panel";
import { SidPanel } from "../../../../components/campaigns/sid-panel";

/**
 * The managers the Logs tab shows under Ad Texts, Offers and SIDs. Their `onChanged` is a
 * refresh made here, in the browser: the server page cannot hand a function to a client
 * component, which is what made these tabs crash.
 */
function useRefresh(): () => void {
  const router = useRouter();
  return () => router.refresh();
}

export function AdTextsLogPanel(props: Omit<ComponentProps<typeof AdTextsPanel>, "onChanged">) {
  return <AdTextsPanel {...props} onChanged={useRefresh()} />;
}

export function OffersLogPanel(props: Omit<ComponentProps<typeof OffersPanel>, "onChanged">) {
  return <OffersPanel {...props} onChanged={useRefresh()} />;
}

export function SidLogPanel(props: Omit<ComponentProps<typeof SidPanel>, "onChanged">) {
  return <SidPanel {...props} onChanged={useRefresh()} />;
}
