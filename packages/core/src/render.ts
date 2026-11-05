/**
 * Message text rendering: the placeholders a campaign text may carry and what the
 * sender fills them with. `{{dynamic}}` is not a text placeholder: it lives in the
 * link URL and is filled by the links service from the message's dynamic id.
 */

export interface RenderVars {
  firstName: string | null;
  phone: string;
  /** The tracked short URL for this message, or null when the campaign has no link. */
  domain: string | null;
}

const PLACEHOLDER_RE = /\{\{\s*(first_name|phone|domain)\s*\}\}/g;

export function renderMessageText(template: string, vars: RenderVars): string {
  return template.replace(PLACEHOLDER_RE, (_match, name: string) => {
    switch (name) {
      case "first_name":
        return vars.firstName ?? "";
      case "phone":
        return vars.phone;
      default:
        return vars.domain ?? "";
    }
  });
}

/** Unambiguous alphabet for short codes: no 0/O, 1/l/I. 54 symbols, 8 chars is about 7e13 codes. */
export const SHORT_CODE_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ";
export const SHORT_CODE_LENGTH = 8;
