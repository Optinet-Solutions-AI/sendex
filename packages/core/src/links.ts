/**
 * Short links: code generation and validation, device classification of a click,
 * and rendering of the tracked destination from its placeholder template.
 * Pure functions; the links service (Cloudflare Worker) and the worker share them.
 */

/** Digits and letters that cannot be confused when read from a phone screen: no 0/O/1/l/I. */
export const SHORT_CODE_ALPHABET = "23456789abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";

export const SHORT_CODE_LENGTH = 8;

const SHORT_CODE_PATTERN = new RegExp(`^[${SHORT_CODE_ALPHABET}]{${SHORT_CODE_LENGTH}}$`);

/** True for exactly eight characters from `SHORT_CODE_ALPHABET`. */
export function isValidShortCode(code: string): boolean {
  return SHORT_CODE_PATTERN.test(code);
}

/**
 * Eight characters drawn from the alphabet with `random`, a function returning a number
 * in [0, 1) like `Math.random`. Deterministic for a deterministic source; out-of-range
 * values are clamped to the ends of the alphabet.
 */
export function generateShortCode(random: () => number = Math.random): string {
  const last = SHORT_CODE_ALPHABET.length - 1;
  let code = "";
  for (let i = 0; i < SHORT_CODE_LENGTH; i += 1) {
    const index = Math.min(last, Math.max(0, Math.floor(random() * SHORT_CODE_ALPHABET.length)));
    code += SHORT_CODE_ALPHABET.charAt(index);
  }
  return code;
}

export type DeviceClass = "mobile" | "tablet" | "desktop" | "bot" | "unknown";

const BOT_PATTERN =
  /bot|crawl|spider|slurp|fetch|preview|externalhit|whatsapp|telegram|discord|slack|skype|viber|linkedin|pinterest|embedly|quora|curl\/|wget\/|python-requests|python-urllib|java\/|okhttp|go-http-client|axios|node-fetch|headlesschrome|phantomjs|lighthouse|pingdom|uptimerobot|monitor/i;

const TABLET_PATTERN = /ipad|tablet|kindle|silk|playbook|nexus (7|9|10)|sm-t|sm-x/i;

const MOBILE_PATTERN =
  /mobile|iphone|ipod|android|windows phone|blackberry|bb10|opera mini|iemobile|webos|symbian|nokia/i;

const DESKTOP_PATTERN = /windows nt|macintosh|mac os x|x11|linux|cros|ubuntu|freebsd/i;

/**
 * Coarse device class from a user agent string. Bots are checked first so a crawler
 * that pretends to be a phone is still a bot; tablets before phones because Android
 * tablets omit "Mobile" and iPads say "Mobile"; the rest falls through to desktop.
 */
export function classifyDevice(userAgent: string | null | undefined): DeviceClass {
  const ua = userAgent?.trim() ?? "";
  if (ua === "") return "unknown";
  if (BOT_PATTERN.test(ua)) return "bot";
  if (TABLET_PATTERN.test(ua)) return "tablet";
  if (MOBILE_PATTERN.test(ua)) return "mobile";
  if (DESKTOP_PATTERN.test(ua)) return "desktop";
  return "unknown";
}

/** Placeholders every tracked link may use, in the order the UI lists them. */
export const LINK_PLACEHOLDERS = [
  "dynamic",
  "geo",
  "campaign_id",
  "list_id",
  "route_name",
  "phone",
] as const;

export type LinkPlaceholder = (typeof LINK_PLACEHOLDERS)[number];

/** Values for the standard placeholders plus any custom ones the template uses. */
export type LinkVars = Partial<Record<LinkPlaceholder, string>> &
  Record<string, string | undefined>;

const PLACEHOLDER_PATTERN = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

/**
 * Replace every `{{name}}` in `template` with the URL-encoded value of `vars[name]`.
 * A placeholder with no value becomes the empty string so the destination stays a valid URL.
 */
export function renderLinkUrl(template: string, vars: LinkVars): string {
  return template.replace(PLACEHOLDER_PATTERN, (_match, name: string) => {
    const value = vars[name];
    return value === undefined ? "" : encodeURIComponent(value);
  });
}
