import { z } from "zod";

/**
 * Pure rules of the Routes pages (D4-06): custom route forms, routing strategies, Send
 * Single / Test SMS inputs and cost estimates, the 15-minute schedule, and the Mobile
 * Networks maths. No I/O.
 */

// ---------------------------------------------------------------------------
// Custom routes
// ---------------------------------------------------------------------------

export const CUSTOM_ROUTE_TYPES = ["http", "smpp"] as const;
export type CustomRouteType = (typeof CUSTOM_ROUTE_TYPES)[number];

/** `routes.provider` values of custom routes; the worker builds a provider per route from its config. */
export const CUSTOM_HTTP_PROVIDER = "custom-http";
export const CUSTOM_SMPP_PROVIDER = "custom-smpp";

export const PLACEHOLDERS = ["{{{from}}}", "{{{number}}}", "{{{text}}}"] as const;

const headerSchema = z.object({
  name: z.string().trim().min(1, "Header name is required").max(100),
  value: z.string().max(1000),
});

const name = z.string().trim().min(1, "Name is required").max(80);

export const customHttpRouteSchema = z.object({
  type: z.literal("http"),
  name,
  apiUrl: z
    .string()
    .trim()
    .url("Enter the full API URL")
    .refine((u) => u.includes("{{{number}}}") || u.includes("{{{text}}}") || true, "")
    .refine(
      (u) => u.includes("{{{number}}}"),
      "Use {{{number}}} in the URL (and {{{from}}}, {{{text}}}) so the message can be substituted",
    ),
  username: z.string().trim().max(200).default(""),
  password: z.string().max(500).default(""),
  usePost: z.boolean().default(true),
  headers: z.array(headerSchema).max(20).default([]),
});

export const customSmppRouteSchema = z.object({
  type: z.literal("smpp"),
  name,
  host: z.string().trim().min(1, "Host is required").max(253),
  port: z.coerce.number().int().min(1).max(65535).default(2775),
  systemId: z.string().trim().min(1, "System ID is required").max(16),
  password: z.string().min(1, "Password is required").max(64),
  systemType: z.string().trim().max(13).default(""),
  tls: z.boolean().default(false),
});

export const customRouteSchema = z.discriminatedUnion("type", [
  customHttpRouteSchema,
  customSmppRouteSchema,
]);
export type CustomRouteInput = z.infer<typeof customRouteSchema>;

/** Split a custom route input into what the row stores in the clear and what it seals. */
export function splitCustomRoute(input: CustomRouteInput): {
  provider: string;
  config: Record<string, unknown>;
  secret: Record<string, string>;
  host: string;
} {
  if (input.type === "http") {
    const url = new URL(input.apiUrl);
    return {
      provider: CUSTOM_HTTP_PROVIDER,
      config: {
        apiUrl: input.apiUrl,
        usePost: input.usePost,
        headers: input.headers,
        username: input.username,
      },
      secret: { password: input.password },
      host: url.host,
    };
  }
  return {
    provider: CUSTOM_SMPP_PROVIDER,
    config: {
      host: input.host,
      port: input.port,
      systemId: input.systemId,
      systemType: input.systemType,
      tls: input.tls,
    },
    secret: { password: input.password },
    host: `${input.host}:${input.port}`,
  };
}

export function isCustomProvider(provider: string): boolean {
  return provider === CUSTOM_HTTP_PROVIDER || provider === CUSTOM_SMPP_PROVIDER;
}

/** "HTTP" or "SMPP" for the badge. */
export function customRouteKind(provider: string): "HTTP" | "SMPP" | null {
  if (provider === CUSTOM_HTTP_PROVIDER) return "HTTP";
  if (provider === CUSTOM_SMPP_PROVIDER) return "SMPP";
  return null;
}

/** Substitute the three placeholders of a custom HTTP route (URL-encoded when `encode`). */
export function fillPlaceholders(
  template: string,
  values: { from: string; number: string; text: string },
  encode = false,
): string {
  const enc = (v: string) => (encode ? encodeURIComponent(v) : v);
  return template
    .replaceAll("{{{from}}}", enc(values.from))
    .replaceAll("{{{number}}}", enc(values.number))
    .replaceAll("{{{text}}}", enc(values.text));
}

export const routePriceInputSchema = z.object({
  country: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, "ISO-2 country code"),
  /** EUR with up to four decimals. */
  priceEur: z
    .string()
    .trim()
    .regex(/^\d+(?:\.\d{1,4})?$/, "Price in EUR, up to four decimals"),
});
export type RoutePriceInput = z.infer<typeof routePriceInputSchema>;

/** "0.0357" → 35_700n micro-EUR. */
export function priceEurToMicro(priceEur: string): bigint {
  const [whole = "0", frac = ""] = priceEur.split(".");
  return BigInt(whole) * 1_000_000n + BigInt((frac + "000000").slice(0, 6));
}

// ---------------------------------------------------------------------------
// Routing configuration
// ---------------------------------------------------------------------------

export const ROUTING_STRATEGIES = ["custom_first", "blended", "platform_first"] as const;
export type RoutingStrategy = (typeof ROUTING_STRATEGIES)[number];

export const ROUTING_STRATEGY_COPY: Record<RoutingStrategy, { label: string; text: string }> = {
  custom_first: {
    label: "Custom routes first",
    text: "Try your routes first, fall back to platform if no match",
  },
  blended: { label: "Blended", text: "All routes compete equally by priority and score" },
  platform_first: {
    label: "Platform routes first",
    text: "Try platform routes first, fall back to yours for uncovered countries",
  },
};

export const routingStrategySchema = z.enum(ROUTING_STRATEGIES);

const uuid = z.string().uuid();

export const routingExceptionSchema = z.object({
  country: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, "ISO-2 country code"),
  routeOrder: z.array(uuid).max(50).default([]),
  disabledRoutes: z.array(uuid).max(50).default([]),
  lockedRoute: uuid.nullable().default(null),
});
export type RoutingExceptionInput = z.infer<typeof routingExceptionSchema>;

export interface RoutableRoute {
  id: string;
  platform: boolean;
  /** Null when unpriced; unpriced routes sort last within their group. */
  priceMicro: bigint | null;
}

export interface RoutingException {
  routeOrder: readonly string[];
  disabledRoutes: readonly string[];
  lockedRoute: string | null;
}

function byPrice(a: RoutableRoute, b: RoutableRoute): number {
  if (a.priceMicro === null && b.priceMicro === null) return 0;
  if (a.priceMicro === null) return 1;
  if (b.priceMicro === null) return -1;
  return a.priceMicro < b.priceMicro ? -1 : a.priceMicro > b.priceMicro ? 1 : 0;
}

/**
 * The order routes are offered (and tried) in for a country: the exception's locked route
 * alone when set; otherwise the exception's explicit order first, then the rest by the
 * strategy (own routes first, platform first, or blended by price), always without the
 * routes the exception disabled.
 */
export function orderRoutes<T extends RoutableRoute>(
  routes: readonly T[],
  strategy: RoutingStrategy,
  exception?: RoutingException | null,
): T[] {
  const disabled = new Set(exception?.disabledRoutes ?? []);
  const enabled = routes.filter((r) => !disabled.has(r.id));
  if (exception?.lockedRoute) {
    const locked = enabled.find((r) => r.id === exception.lockedRoute);
    if (locked) return [locked];
  }
  const explicit = (exception?.routeOrder ?? [])
    .map((id) => enabled.find((r) => r.id === id))
    .filter((r): r is T => r !== undefined);
  const explicitIds = new Set(explicit.map((r) => r.id));
  const rest = enabled.filter((r) => !explicitIds.has(r.id));
  const custom = rest.filter((r) => !r.platform).sort(byPrice);
  const platform = rest.filter((r) => r.platform).sort(byPrice);
  let ordered: T[];
  switch (strategy) {
    case "custom_first":
      ordered = [...custom, ...platform];
      break;
    case "platform_first":
      ordered = [...platform, ...custom];
      break;
    case "blended":
      ordered = [...rest].sort((a, b) => byPrice(a, b) || Number(a.platform) - Number(b.platform));
      break;
  }
  return [...explicit, ...ordered];
}

// ---------------------------------------------------------------------------
// Send Single / Test SMS
// ---------------------------------------------------------------------------

export const SENDER_MODES = [
  { key: "random_string", label: "Random String", example: "AIFJE" },
  { key: "random_casino", label: "Random Casino Name", example: "BetVIP" },
  { key: "random_shop", label: "Random Shop Name", example: "DealHub" },
  { key: "custom", label: "Custom", example: "" },
] as const;
export type SenderMode = (typeof SENDER_MODES)[number]["key"];
const SENDER_MODE_KEYS = SENDER_MODES.map((m) => m.key) as [SenderMode, ...SenderMode[]];

export const TEXT_PRESETS = [
  {
    key: "generic_ecommerce",
    label: "Generic E-Commerce",
    group: "system",
    sample: "Your order is ready. Track it here: {{domain}}",
  },
  {
    key: "casino_new_domain",
    label: "Casino + New Domain",
    group: "system",
    sample: "200 free spins are waiting for you today: {{domain}}",
  },
  {
    key: "hi_no_domain",
    label: "Hi Text + No Domain",
    group: "system",
    sample: "Hi, how are you?",
  },
  {
    key: "casino_used_domain",
    label: "Casino + Used Domain",
    group: "system",
    sample: "Your bonus expires tonight. Claim it: {{domain}}",
  },
  {
    key: "generic_random_domain",
    label: "Generic + Random Domain",
    group: "system",
    sample: "Hello! Here is the link you asked for: {{domain}}",
  },
  {
    key: "telegram_invite",
    label: "Telegram Invite",
    group: "system",
    sample: "Join our Telegram channel for daily tips: t.me/sendex",
  },
  {
    key: "random_history",
    label: "Random from History",
    group: "system",
    sample: "A text taken from one of your sent campaigns",
  },
  { key: "custom", label: "Custom Text", group: "custom", sample: "" },
] as const;
export type TextPreset = (typeof TEXT_PRESETS)[number]["key"];
const TEXT_PRESET_KEYS = TEXT_PRESETS.map((p) => p.key) as [TextPreset, ...TextPreset[]];

const CASINO_NAMES = ["BetVIP", "LuckyRoyal", "SpinPalace", "GoldenAce", "JackpotHub", "VegasOne"];
const SHOP_NAMES = ["DealHub", "ShopNow", "BestBuyz", "MegaMart", "QuickCart", "TopDeals"];
const DOMAINS = ["win-today.click", "bonus-now.sbs", "go-fast.link", "offer-hub.site"];

export type Rng = () => number;

function pick<T>(items: readonly T[], rng: Rng): T {
  const index = Math.min(items.length - 1, Math.floor(rng() * items.length));
  return items[index] as T;
}

/** The sender id a mode produces (uppercase letters for Random String, 3 to 11 characters). */
export function generateSenderId(
  mode: SenderMode,
  custom: string | null,
  rng: Rng = Math.random,
): string {
  switch (mode) {
    case "random_string": {
      let s = "";
      for (let i = 0; i < 5; i += 1) s += String.fromCharCode(65 + Math.floor(rng() * 26));
      return s;
    }
    case "random_casino":
      return pick(CASINO_NAMES, rng);
    case "random_shop":
      return pick(SHOP_NAMES, rng);
    case "custom":
      return (custom ?? "").trim() || "SENDEX";
  }
}

/** The text a preset produces; "Random from History" takes one of `history` (or a fallback). */
export function presetText(
  preset: TextPreset,
  options: { custom?: string | null; history?: readonly string[]; rng?: Rng } = {},
): string {
  const rng = options.rng ?? Math.random;
  const domain = pick(DOMAINS, rng);
  const def = TEXT_PRESETS.find((p) => p.key === preset);
  switch (preset) {
    case "custom":
      return (options.custom ?? "").trim() || "Hi, how are you?";
    case "random_history":
      return options.history && options.history.length > 0
        ? pick(options.history, rng)
        : "Hi, how are you?";
    default:
      return (def?.sample ?? "Hi, how are you?").replaceAll("{{domain}}", `https://${domain}`);
  }
}

export const WEEKDAYS = [
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
  { value: 7, label: "Sunday" },
] as const;

/** "00:00" … "23:45" in 15-minute steps, UTC. */
export const TIME_SLOTS: readonly string[] = Array.from({ length: 96 }, (_, i) => {
  const h = Math.floor(i / 4);
  const m = (i % 4) * 15;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
});

export const testScheduleSchema = z.object({
  days: z.array(z.number().int().min(1).max(7)).min(1, "Pick at least one day"),
  times: z
    .array(z.string().regex(/^([01]\d|2[0-3]):(00|15|30|45)$/, "Times are 15-minute slots"))
    .min(1, "Pick at least one time"),
});
export type TestSchedule = z.infer<typeof testScheduleSchema>;

export const smsTestSchema = z
  .object({
    type: z.enum(["single", "test"]),
    country: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2}$/, "Pick a destination country"),
    /** Digits only, international format; required for a single send. */
    recipient: z
      .string()
      .trim()
      .regex(/^\d{6,15}$/, "International format, digits only")
      .optional(),
    routeIds: z.array(uuid).min(1, "Pick at least one route").max(20),
    senderModes: z.array(z.enum(SENDER_MODE_KEYS)).min(1, "Pick at least one sender id"),
    customSender: z.string().trim().max(11).default(""),
    textPresets: z.array(z.enum(TEXT_PRESET_KEYS)).min(1, "Pick at least one text"),
    customText: z.string().trim().max(1000).default(""),
    hypothesis: z.string().trim().max(500).default(""),
    jitter: z.boolean().default(false),
    cascade: z.boolean().default(false),
    schedule: testScheduleSchema.nullable().default(null),
    testNetworks: z.array(z.string().trim().min(1)).max(50).default([]),
  })
  .superRefine((v, ctx) => {
    if (v.type === "single" && !v.recipient) {
      ctx.addIssue({ code: "custom", path: ["recipient"], message: "Recipient is required" });
    }
    if (v.senderModes.includes("custom") && !/^[A-Za-z0-9]{3,11}$/.test(v.customSender)) {
      ctx.addIssue({
        code: "custom",
        path: ["customSender"],
        message: "Custom sender id: 3 to 11 letters or digits",
      });
    }
    if (v.textPresets.includes("custom") && v.customText.length === 0) {
      ctx.addIssue({ code: "custom", path: ["customText"], message: "Enter the custom text" });
    }
  });
export type SmsTestInput = z.infer<typeof smsTestSchema>;

export interface TestCombo {
  senderMode: SenderMode;
  textPreset: TextPreset;
}

/** One test per sender id × text option combination. */
export function expandTestCombos(input: {
  senderModes: readonly SenderMode[];
  textPresets: readonly TextPreset[];
}): TestCombo[] {
  const combos: TestCombo[] = [];
  for (const senderMode of input.senderModes) {
    for (const textPreset of input.textPresets) combos.push({ senderMode, textPreset });
  }
  return combos;
}

export interface TestCostRow {
  type: string;
  tests: number;
  costMicro: bigint;
}

/**
 * The Cost Estimate table: with cascade one message per combination (through the routes in
 * order until one accepts, priced at the dearest); otherwise one per combination and route.
 */
export function testCostEstimate(input: {
  combos: number;
  routes: ReadonlyArray<{ priceMicro: bigint | null }>;
  cascade: boolean;
  label?: string;
}): { rows: TestCostRow[]; tests: number; totalMicro: bigint } {
  const prices = input.routes.map((r) => r.priceMicro ?? 0n);
  let tests: number;
  let totalMicro: bigint;
  if (input.cascade) {
    tests = input.routes.length > 0 ? input.combos : 0;
    // biome-ignore lint/complexity/useMathMinMax: bigint has no Math.max
    const dearest = prices.reduce((m, p) => (p > m ? p : m), 0n);
    totalMicro = dearest * BigInt(tests);
  } else {
    tests = input.combos * input.routes.length;
    totalMicro = prices.reduce((t, p) => t + p * BigInt(input.combos), 0n);
  }
  const rows =
    tests > 0 ? [{ type: input.label ?? "Single SMS", tests, costMicro: totalMicro }] : [];
  return { rows, tests, totalMicro };
}

export interface ScheduleSlot {
  /** 1 = Monday … 7 = Sunday, UTC. */
  day: number;
  /** "HH:MM" floored to the quarter hour. */
  time: string;
  /** "YYYY-MM-DDTHH:MM", unique per quarter hour. */
  key: string;
}

export function scheduleSlot(now: Date): ScheduleSlot {
  const day = ((now.getUTCDay() + 6) % 7) + 1;
  const minutes = Math.floor(now.getUTCMinutes() / 15) * 15;
  const time = `${String(now.getUTCHours()).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  return { day, time, key: `${now.toISOString().slice(0, 10)}T${time}` };
}

/** Whether a scheduled test should fire now: the slot matches and it has not fired for it. */
export function scheduleDue(
  schedule: TestSchedule,
  now: Date,
  lastSlot: string | null,
): ScheduleSlot | null {
  const slot = scheduleSlot(now);
  if (!schedule.days.includes(slot.day) || !schedule.times.includes(slot.time)) return null;
  if (lastSlot === slot.key) return null;
  return slot;
}

/** Random delay before each test when jitter is on: 0 to `maxMs` (default 60 s). */
export function jitterDelayMs(rng: Rng = Math.random, maxMs = 60_000): number {
  return Math.floor(rng() * maxMs);
}

// ---------------------------------------------------------------------------
// Mobile networks
// ---------------------------------------------------------------------------

export interface NetworkStat {
  country: string;
  operator: string;
  routeId: string;
  routeName: string;
  sent: number;
  previews: number;
  clicks: number;
  leads: number;
  sales: number;
}

export interface NetworkRouteRow {
  routeId: string;
  routeName: string;
  sent: number;
  clicks: number;
  ctr: number;
  leads: number;
  sales: number;
}

export interface NetworkRow {
  operator: string;
  sent: number;
  previews: number;
  clicks: number;
  ctr: number;
  /** CTR minus the country CTR, in ratio points. */
  ctrDelta: number;
  leads: number;
  sales: number;
  /** Sent over the country's sent. */
  share: number;
  lowVolume: boolean;
  routes: NetworkRouteRow[];
}

export interface CountryNetworks {
  country: string;
  sent: number;
  clicks: number;
  ctr: number;
  networks: NetworkRow[];
}

export interface MobileNetworksView {
  countries: CountryNetworks[];
  kpis: {
    countries: number;
    networks: number;
    sent: number;
    clicks: number;
    ctr: number;
    leads: number;
    sales: number;
  };
  /** Operators under the volume floor, hidden unless asked for. */
  hiddenCount: number;
}

/** CTR is only meaningful above this many messages; operators below are hidden by default. */
export const NETWORK_MIN_SENT = 100;

/** Group route-level operator stats into the Mobile Networks cards, busiest country first. */
export function mobileNetworks(
  stats: readonly NetworkStat[],
  options: { minSent?: number; showLowVolume?: boolean } = {},
): MobileNetworksView {
  const minSent = options.minSent ?? NETWORK_MIN_SENT;
  const byCountry = new Map<string, Map<string, NetworkStat[]>>();
  for (const s of stats) {
    const ops = byCountry.get(s.country) ?? new Map<string, NetworkStat[]>();
    const list = ops.get(s.operator) ?? [];
    list.push(s);
    ops.set(s.operator, list);
    byCountry.set(s.country, ops);
  }
  let hiddenCount = 0;
  const kpis = { countries: 0, networks: 0, sent: 0, clicks: 0, ctr: 0, leads: 0, sales: 0 };
  const countries: CountryNetworks[] = [];
  for (const [country, ops] of byCountry) {
    const all = [...ops.values()].flat();
    const sent = all.reduce((t, s) => t + s.sent, 0);
    const clicks = all.reduce((t, s) => t + s.clicks, 0);
    const countryCtr = sent > 0 ? clicks / sent : 0;
    const networks: NetworkRow[] = [];
    for (const [operator, rows] of ops) {
      const opSent = rows.reduce((t, s) => t + s.sent, 0);
      const opClicks = rows.reduce((t, s) => t + s.clicks, 0);
      const lowVolume = opSent < minSent;
      if (lowVolume) hiddenCount += 1;
      if (lowVolume && !options.showLowVolume) continue;
      const ctr = opSent > 0 ? opClicks / opSent : 0;
      networks.push({
        operator,
        sent: opSent,
        previews: rows.reduce((t, s) => t + s.previews, 0),
        clicks: opClicks,
        ctr,
        ctrDelta: ctr - countryCtr,
        leads: rows.reduce((t, s) => t + s.leads, 0),
        sales: rows.reduce((t, s) => t + s.sales, 0),
        share: sent > 0 ? opSent / sent : 0,
        lowVolume,
        routes: rows
          .map((r) => ({
            routeId: r.routeId,
            routeName: r.routeName,
            sent: r.sent,
            clicks: r.clicks,
            ctr: r.sent > 0 ? r.clicks / r.sent : 0,
            leads: r.leads,
            sales: r.sales,
          }))
          .sort((a, b) => b.sent - a.sent),
      });
    }
    networks.sort((a, b) => b.sent - a.sent || a.operator.localeCompare(b.operator));
    if (networks.length === 0) continue;
    countries.push({ country, sent, clicks, ctr: countryCtr, networks });
    kpis.countries += 1;
    kpis.networks += networks.length;
    kpis.sent += networks.reduce((t, n) => t + n.sent, 0);
    kpis.clicks += networks.reduce((t, n) => t + n.clicks, 0);
    kpis.leads += networks.reduce((t, n) => t + n.leads, 0);
    kpis.sales += networks.reduce((t, n) => t + n.sales, 0);
  }
  kpis.ctr = kpis.sent > 0 ? kpis.clicks / kpis.sent : 0;
  countries.sort((a, b) => b.sent - a.sent || a.country.localeCompare(b.country));
  return { countries, kpis, hiddenCount };
}
