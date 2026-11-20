import { z } from "zod";

/**
 * The Existing / New switch (D5-11). An organisation with `preview_toggle` on lets each of its
 * people choose: Existing (the default) is the app without the preview features, New shows
 * them (the Performance screens and the list data provider). The choice is kept in a cookie
 * per organisation, so it follows the person's browser and never changes what anyone else sees.
 * An organisation with `preview_features` on always sees the features and gets no switch.
 */
export const PREVIEW_VIEWS = ["existing", "new"] as const;
export type PreviewView = (typeof PREVIEW_VIEWS)[number];

export const previewViewSchema = z.enum(PREVIEW_VIEWS);

export function parsePreviewView(value: unknown): PreviewView {
  return previewViewSchema.parse(value);
}

/** The cookie that holds one organisation's choice. */
export function previewViewCookie(organisationId: string): string {
  return `sendex-view-${organisationId}`;
}

export interface PreviewState {
  /** Whether the preview features are shown in this request. */
  previewFeatures: boolean;
  /** The switch's position, or null when the organisation has no switch. */
  previewView: PreviewView | null;
}

export function previewState(
  organisation: { previewFeatures: boolean; previewToggle: boolean },
  cookie: string | undefined,
): PreviewState {
  if (organisation.previewFeatures) return { previewFeatures: true, previewView: null };
  if (!organisation.previewToggle) return { previewFeatures: false, previewView: null };
  const view: PreviewView = cookie === "new" ? "new" : "existing";
  return { previewFeatures: view === "new", previewView: view };
}
