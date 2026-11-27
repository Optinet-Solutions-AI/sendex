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
  /bot|crawl|spider|slurp|fetch|preview|externalhit|antispam|scanner|whatsapp|telegram|discord|slack|skype|viber|linkedin|pinterest|embedly|quora|curl\/|wget\/|python-requests|python-urllib|java\/|okhttp|go-http-client|axios|node-fetch|headlesschrome|phantomjs|lighthouse|pingdom|uptimerobot|monitor/i;

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

/**
 * Cloud and hosting networks (Cloudflare's `asOrganization` for the address that opened the
 * link). A click from one of these is an automated link scanner, not a person: on the first
 * real campaign (20 November 2026) 108 of 126 clicks came from Google's servers in the
 * Netherlands and the US within seconds of each SMS, with an ordinary Chrome user agent that
 * the user-agent check cannot catch (D5-13).
 *
 * Deliberately left out: networks that carry real people through a privacy relay or VPN,
 * such as Akamai Technologies and Fastly (iCloud Private Relay) and Cloudflare (WARP), and
 * consumer networks of the same companies, such as Google Fiber.
 */
const DATA_CENTRE_NETWORKS =
  /^(google llc|google cloud|google-cloud|youtube|amazon|aws\b|microsoft corp|microsoft-corp|digitalocean|m247|ovh|hetzner|akamai connected cloud|linode|oracle (corporation|cloud|public cloud)|alibaba|tencent|the constant company|vultr|choopa|contabo|leaseweb|scaleway|online s\.a\.s|hostinger|ionos|1&1 ionos|transip|datacamp|hostroyale|g-core|gcore|lonconnect)/i;

/** True when the network that opened a link is a cloud or hosting network (D5-13). */
export function isDataCentreNetwork(network: string | null | undefined): boolean {
  const name = network?.trim() ?? "";
  return name !== "" && DATA_CENTRE_NETWORKS.test(name);
}

/**
 * The class of one click: a bot when it came from a data-centre network, whatever browser it
 * claims to be; otherwise the class of its user agent.
 */
export function classifyClick(
  userAgent: string | null | undefined,
  network: string | null | undefined,
): DeviceClass {
  return isDataCentreNetwork(network) ? "bot" : classifyDevice(userAgent);
}

/**
 * A desktop Linux or Windows browser opening a link sent by SMS: link scanners present
 * themselves this way (37,632 of SMS Edge's 37,634 "X11; Linux x86_64" clicks in a week of
 * November 2026 were bots, and 583 of 624 Windows ones). Mac stays a person (iPad desktop
 * mode reads as Macintosh).
 */
const SCANNER_DESKTOP_PATTERN = /x11; linux x86_64|windows nt/i;

export type ClickVerdict = DeviceClass | "other_country";

export interface ClickFacts {
  userAgent: string | null | undefined;
  /** Network that opened the link (Cloudflare's `asOrganization`). */
  network: string | null | undefined;
  /** Country the click came from (Cloudflare), when known. */
  clickCountry?: string | null | undefined;
  /** Country of the phone number the SMS went to, when known. */
  phoneCountry?: string | null | undefined;
}

/**
 * Whether a click on an SMS link is a person (D5-22), following the rules SMS Edge states
 * for its own click counts: carrier and app link scanners, previews and automated systems do
 * not count, and clicks from outside the target country are kept apart. In order:
 * - a cloud, hosting or proxy network, a robot or empty user agent (carrier spam filters such
 *   as `antispam/1.0.0` included), or a desktop Linux / Windows browser: `bot`;
 * - a click from another country than the phone's, when both are known: `other_country`;
 * - otherwise the device class of the user agent.
 * Only the counting changes: every click is still forwarded to the offer.
 */
export function clickVerdict(facts: ClickFacts): ClickVerdict {
  if (isDataCentreNetwork(facts.network)) return "bot";
  const device = classifyDevice(facts.userAgent);
  if (device === "bot" || device === "unknown") return "bot";
  if (device === "desktop" && SCANNER_DESKTOP_PATTERN.test(facts.userAgent ?? "")) return "bot";
  const click = facts.clickCountry?.trim().toUpperCase();
  const phone = facts.phoneCountry?.trim().toUpperCase();
  if (click && phone && click !== phone) return "other_country";
  return device;
}

/** Placeholders every tracked link may use, in the order the UI lists them. */
export const LINK_URL_PLACEHOLDERS = [
  "dynamic",
  "geo",
  "campaign_id",
  "list_id",
  "route_name",
  "phone",
] as const;

export type LinkPlaceholder = (typeof LINK_URL_PLACEHOLDERS)[number];

/** Values for the standard placeholders plus any custom ones the template uses. */
export type LinkVars = Partial<Record<LinkPlaceholder, string>> &
  Record<string, string | undefined>;

/**
 * `{{name}}`, and `{{{name}}}` as SMS Edge writes it (D4-21). The third brace on each side is
 * part of the placeholder: matching only two would leave `{value}` in the destination, and the
 * tracker would then report a click id the postback cannot be matched on.
 */
const PLACEHOLDER_PATTERN = /\{\{\{?\s*([A-Za-z0-9_]+)\s*\}\}\}?/g;

/**
 * Replace every `{{name}}` or `{{{name}}}` in `template` with the URL-encoded value of
 * `vars[name]`. A placeholder with no value becomes the empty string so the destination stays
 * a valid URL.
 */
export function renderLinkUrl(template: string, vars: LinkVars): string {
  return template.replace(PLACEHOLDER_PATTERN, (_match, name: string) => {
    const value = vars[name];
    return value === undefined ? "" : encodeURIComponent(value);
  });
}

/**
 * The shortener domain a lap puts in its SMS (D4-22): every lap of a campaign takes the next
 * one, so two laps in a row never share an address, and it starts over when the campaign has
 * more laps than there are domains. `lapIndex` is the lap's place among the campaign's laps,
 * 0 for the first. The domains are put in alphabetical order first, so the order the
 * shortener lists them in does not move a lap to another domain. Null when there is none.
 */
export function shortDomainForLap(domains: readonly string[], lapIndex: number): string | null {
  const hosts = [...new Set(domains.map((d) => d.trim().toLowerCase()).filter(Boolean))].sort();
  if (hosts.length === 0) return null;
  const index = Number.isInteger(lapIndex) && lapIndex > 0 ? lapIndex : 0;
  return hosts[index % hosts.length] ?? null;
}
