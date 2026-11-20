import { cookies } from "next/headers";
import { type PreviewState, previewState, previewViewCookie } from "./preview";

/**
 * The preview fields of the context: the organisation's two switches plus, when it offers the
 * Existing / New switch, this browser's choice for it (a cookie, see `preview.ts`).
 */
export async function previewContext(organisation: {
  id: string;
  previewFeatures?: boolean | null;
  previewToggle?: boolean | null;
}): Promise<PreviewState> {
  const switches = {
    previewFeatures: organisation.previewFeatures === true,
    previewToggle: organisation.previewToggle === true,
  };
  if (switches.previewFeatures || !switches.previewToggle) return previewState(switches, undefined);
  const jar = await cookies();
  return previewState(switches, jar.get(previewViewCookie(organisation.id))?.value);
}
