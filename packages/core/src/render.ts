/**
 * Message text rendering: the placeholders a campaign text may carry and what the
 * sender fills them with. `{{dynamic}}` is not a text placeholder: it lives in the
 * link URL and is filled by the links service from the message's dynamic id.
 */

import { SHORT_CODE_LENGTH } from "./links.js";

export interface RenderVars {
  firstName: string | null;
  lastName?: string | null;
  phone: string;
  /** The tracked short URL for this message, or null when the campaign has no link. */
  domain: string | null;
}

/** Chooses one option of a `{a|b|c}` words randomizer. */
export type PickOption = (options: readonly string[]) => string;

const randomOption: PickOption = (options) =>
  options[Math.floor(Math.random() * options.length)] ?? "";

/** `{a|b|c}`: single braces, at least one bar, no braces inside. `{{domain}}` never matches. */
const RANDOMIZER_RE = /\{([^{}|]*(?:\|[^{}|]*)+)\}/g;

/** Resolve every words randomizer in `template` to one of its options. */
export function pickRandomWords(template: string, pick: PickOption = randomOption): string {
  return template.replace(RANDOMIZER_RE, (_match, options: string) => pick(options.split("|")));
}

const PLACEHOLDER_RE = /\{\{\s*(first_name|last_name|phone|domain)\s*\}\}/g;

/**
 * The text one recipient receives. Randomizers are resolved first, on the template only, so a
 * contact name that looks like `{a|b}` is sent as written.
 */
export function renderMessageText(
  template: string,
  vars: RenderVars,
  pick: PickOption = randomOption,
): string {
  return pickRandomWords(template, pick).replace(PLACEHOLDER_RE, (_match, name: string) => {
    switch (name) {
      case "first_name":
        return vars.firstName ?? "";
      case "last_name":
        return vars.lastName ?? "";
      case "phone":
        return vars.phone;
      default:
        return vars.domain ?? "";
    }
  });
}

/** Used when the links base URL is not configured: longer than the usual short link. */
export const FALLBACK_LINK_LENGTH = 50;

/** Characters `{{domain}}` becomes when sent: `<base>/<short code>`. */
export function shortLinkLength(linksBaseUrl: string | null | undefined): number {
  const base = linksBaseUrl?.trim().replace(/\/+$/, "");
  if (!base) return FALLBACK_LINK_LENGTH;
  return base.length + 1 + SHORT_CODE_LENGTH;
}

/** Unambiguous alphabet for short codes: no 0/O, 1/l/I. 54 symbols, 8 chars is about 7e13 codes. */
