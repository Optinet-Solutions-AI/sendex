/**
 * Pure maths of the dashboard tabs (D4-05): folding country series into "top N + Other",
 * the ROI pivot, cumulative series, cost per sale over time, send-count buckets, country
 * status and the insight cards. Everything here is deterministic and tested without I/O.
 */

export interface SeriesPoint {
  /** A month ("2026-11"), a week ("2026-11-02") or any x value. */
  period: string;
  /** The series key, typically an ISO-2 country. */
  key: string;
  value: number;
}

export type SeriesRow = { period: string } & Record<string, number | string>;

export interface FoldedSeries {
  /** Series in fixed order (largest total first), "Other" last when present. */
  series: string[];
  periods: string[];
  rows: SeriesRow[];
}

export const OTHER = "Other";

/**
 * Keep the `top` series with the largest totals, in that fixed order, and fold the rest into
 * "Other". One row per period with every series present (0 when absent), so the stack is
 * stable whatever the filter does.
 */
export function foldSeries(points: readonly SeriesPoint[], top = 8): FoldedSeries {
  const totals = new Map<string, number>();
  for (const p of points) totals.set(p.key, (totals.get(p.key) ?? 0) + p.value);
  const ranked = [...totals.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([key]) => key);
  const kept = ranked.slice(0, top);
  const folded = ranked.length > top;
  const series = folded ? [...kept, OTHER] : kept;
  const keptSet = new Set(kept);
  const periods = [...new Set(points.map((p) => p.period))].sort();
  const rows = periods.map((period) => {
    const row: SeriesRow = { period };
    for (const s of series) row[s] = 0;
    for (const p of points) {
      if (p.period !== period) continue;
      const s = keptSet.has(p.key) ? p.key : OTHER;
      row[s] = Number(row[s] ?? 0) + p.value;
    }
    return row;
  });
  return { series, periods, rows };
}

/** Each series accumulated over the periods: the "accumulated over time" area charts. */
export function cumulativeByCountry(points: readonly SeriesPoint[]): SeriesRow[] {
  const keys = [...new Set(points.map((p) => p.key))].sort();
  const periods = [...new Set(points.map((p) => p.period))].sort();
  const running = new Map<string, number>(keys.map((k) => [k, 0]));
  return periods.map((period) => {
    for (const p of points) {
      if (p.period === period) running.set(p.key, (running.get(p.key) ?? 0) + p.value);
    }
    const row: SeriesRow = { period };
    for (const k of keys) row[k] = running.get(k) ?? 0;
    return row;
  });
}

// ---------------------------------------------------------------------------
// ROI pivot
// ---------------------------------------------------------------------------

export interface PivotCounters {
  cost: bigint;
  clicks: number;
  leads: number;
  sales: number;
  /** Sale value reported by postbacks (or the offer's profit per sale), micro-EUR. */
  revenue: bigint;
}

export interface PivotRow extends PivotCounters {
  country: string;
  link: string;
  list: string;
  /** "YYYY-MM". */
  month: string;
}

export type PivotDimension = "country" | "link" | "list" | "date";

export interface PivotMetrics extends PivotCounters {
  cpcMicro: bigint | null;
  cplMicro: bigint | null;
  cpsMicro: bigint | null;
  /** Clicks to leads, leads per click. */
  ctl: number | null;
  /** Clicks to sales. */
  cts: number | null;
  /** Leads to sales. */
  lts: number | null;
  profitMicro: bigint;
  /** Profit over cost, null without cost. */
  roi: number | null;
}

export type PivotMetricKey =
  | "cost"
  | "clicks"
  | "leads"
  | "sales"
  | "cpc"
  | "cpl"
  | "cps"
  | "ctl"
  | "cts"
  | "lts"
  | "profit"
  | "roi";

export interface PivotMetricDef {
  key: PivotMetricKey;
  label: string;
  description: string;
  default: boolean;
}

/** The Metrics menu, in its order, with the ones ticked by default. */
export const ROI_METRICS: readonly PivotMetricDef[] = [
  {
    key: "cost",
    label: "Cost",
    description: "Spend, with unattributed messages included",
    default: true,
  },
  {
    key: "clicks",
    label: "Clicks",
    description: "Messages that produced at least one click",
    default: true,
  },
  { key: "leads", label: "Leads", description: "Signups reported by your tracker", default: true },
  { key: "sales", label: "Sales", description: "FTDs reported by your tracker", default: true },
  { key: "cpc", label: "CPC", description: "Cost per click", default: true },
  { key: "cpl", label: "CPL", description: "Cost per lead", default: true },
  { key: "cps", label: "CPS", description: "Cost per sale", default: true },
  { key: "ctl", label: "CtL", description: "Clicks to leads", default: false },
  { key: "cts", label: "CtS", description: "Clicks to sales", default: false },
  { key: "lts", label: "LtS", description: "Leads to sales", default: false },
  { key: "profit", label: "Profit", description: "Revenue minus cost", default: true },
  { key: "roi", label: "ROI", description: "Profit over cost", default: true },
];

function per(micro: bigint, count: number): bigint | null {
  return count > 0 ? micro / BigInt(count) : null;
}

function ratio(a: number, b: number): number | null {
  return b > 0 ? a / b : null;
}

export function pivotMetrics(c: PivotCounters): PivotMetrics {
  const profitMicro = c.revenue - c.cost;
  return {
    ...c,
    cpcMicro: per(c.cost, c.clicks),
    cplMicro: per(c.cost, c.leads),
    cpsMicro: per(c.cost, c.sales),
    ctl: ratio(c.leads, c.clicks),
    cts: ratio(c.sales, c.clicks),
    lts: ratio(c.sales, c.leads),
    profitMicro,
    roi: c.cost > 0n ? Number(profitMicro) / Number(c.cost) : null,
  };
}

export interface PivotNode {
  key: string;
  label: string;
  /** Labels from the root down to this node. */
  path: string[];
  depth: number;
  metrics: PivotMetrics;
  children: PivotNode[];
}

export interface PivotTree {
  nodes: PivotNode[];
  total: PivotNode;
}

export interface PivotOptions {
  sort?: PivotMetricKey;
  dir?: "asc" | "desc";
}

function dimensionValue(row: PivotRow, dim: PivotDimension): string {
  return dim === "date" ? row.month : row[dim];
}

function sum(rows: readonly PivotRow[]): PivotCounters {
  let cost = 0n;
  let clicks = 0;
  let leads = 0;
  let sales = 0;
  let revenue = 0n;
  for (const r of rows) {
    cost += r.cost;
    clicks += r.clicks;
    leads += r.leads;
    sales += r.sales;
    revenue += r.revenue;
  }
  return { cost, clicks, leads, sales, revenue };
}

/** The sortable number of a metric; nulls sort last whatever the direction. */
export function metricValue(m: PivotMetrics, key: PivotMetricKey): number | null {
  switch (key) {
    case "cost":
      return Number(m.cost);
    case "clicks":
      return m.clicks;
    case "leads":
      return m.leads;
    case "sales":
      return m.sales;
    case "cpc":
      return m.cpcMicro === null ? null : Number(m.cpcMicro);
    case "cpl":
      return m.cplMicro === null ? null : Number(m.cplMicro);
    case "cps":
      return m.cpsMicro === null ? null : Number(m.cpsMicro);
    case "ctl":
      return m.ctl;
    case "cts":
      return m.cts;
    case "lts":
      return m.lts;
    case "profit":
      return Number(m.profitMicro);
    case "roi":
      return m.roi;
  }
}

function build(
  rows: readonly PivotRow[],
  dims: readonly PivotDimension[],
  path: string[],
  options: Required<PivotOptions>,
): PivotNode[] {
  const [dim, ...rest] = dims;
  if (dim === undefined) return [];
  const groups = new Map<string, PivotRow[]>();
  for (const r of rows) {
    const value = dimensionValue(r, dim);
    const list = groups.get(value);
    if (list) list.push(r);
    else groups.set(value, [r]);
  }
  const nodes = [...groups.entries()].map(([key, groupRows]): PivotNode => {
    const nodePath = [...path, key];
    return {
      key: nodePath.join(" / "),
      label: key,
      path: nodePath,
      depth: path.length,
      metrics: pivotMetrics(sum(groupRows)),
      children: build(groupRows, rest, nodePath, options),
    };
  });
  const sign = options.dir === "asc" ? 1 : -1;
  nodes.sort((a, b) => {
    const va = metricValue(a.metrics, options.sort);
    const vb = metricValue(b.metrics, options.sort);
    if (va === null && vb === null) return a.label.localeCompare(b.label);
    if (va === null) return 1;
    if (vb === null) return -1;
    return (va - vb) * sign || a.label.localeCompare(b.label);
  });
  return nodes;
}

/** The ROI pivot: rows nested by `dims` in order, each level sorted by the chosen metric. */
export function pivotTree(
  rows: readonly PivotRow[],
  dims: readonly PivotDimension[],
  options: PivotOptions = {},
): PivotTree {
  const resolved: Required<PivotOptions> = {
    sort: options.sort ?? "cost",
    dir: options.dir ?? "desc",
  };
  return {
    nodes: build(rows, dims, [], resolved),
    total: {
      key: "total",
      label: "Grand Total",
      path: [],
      depth: 0,
      metrics: pivotMetrics(sum(rows)),
      children: [],
    },
  };
}

// ---------------------------------------------------------------------------
// Cost per sale over time
// ---------------------------------------------------------------------------

export interface MonthlyCostSales {
  month: string;
  cost: bigint;
  sales: number;
}

export interface CpsPoint {
  month: string;
  monthlyCpsMicro: bigint | null;
  cumulativeCpsMicro: bigint | null;
}

/** Monthly and cumulative cost per sale, in month order. */
export function cpsOverTime(rows: readonly MonthlyCostSales[]): CpsPoint[] {
  let cost = 0n;
  let sales = 0;
  return [...rows]
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((r) => {
      cost += r.cost;
      sales += r.sales;
      return {
        month: r.month,
        monthlyCpsMicro: per(r.cost, r.sales),
        cumulativeCpsMicro: per(cost, sales),
      };
    });
}

// ---------------------------------------------------------------------------
// Contacts and countries
// ---------------------------------------------------------------------------

export const SEND_BUCKETS = ["0", "1–2", "3–5", "6–10", "11+"] as const;
export type SendBucket = (typeof SEND_BUCKETS)[number];

/** The bucket of the send-count distribution a contact with `sent` messages belongs to. */
export function bucketFor(sent: number): SendBucket {
  if (sent <= 0) return "0";
  if (sent <= 2) return "1–2";
  if (sent <= 5) return "3–5";
  if (sent <= 10) return "6–10";
  return "11+";
}

export type CountryStatus = "healthy" | "under-worked";

/** Utilisation (sends over contacts) at or above this is "Healthy". */
export const HEALTHY_UTILISATION = 0.5;

export function countryStatus(utilisation: number): CountryStatus {
  return utilisation >= HEALTHY_UTILISATION ? "healthy" : "under-worked";
}

export interface CountryEconomics {
  country: string;
  contacts: number;
  sent: number;
  sales: number;
  costMicro: bigint;
}

export interface InsightCards {
  /** The under-worked country with the most unused contacts. */
  opportunity: { country: string; contacts: number; utilisation: number } | null;
  /** Countries with sales, dearest cost per sale first. */
  economics: Array<{ country: string; cpsMicro: bigint }>;
}

export function insightCards(rows: readonly CountryEconomics[]): InsightCards {
  let opportunity: InsightCards["opportunity"] = null;
  let bestUnused = 0;
  for (const r of rows) {
    const utilisation = r.contacts > 0 ? r.sent / r.contacts : 0;
    if (countryStatus(utilisation) !== "under-worked") continue;
    const unused = r.contacts * (1 - Math.min(1, utilisation));
    if (unused > bestUnused) {
      bestUnused = unused;
      opportunity = { country: r.country, contacts: r.contacts, utilisation };
    }
  }
  const economics = rows
    .filter((r) => r.sales > 0)
    .map((r) => ({ country: r.country, cpsMicro: r.costMicro / BigInt(r.sales) }))
    .sort((a, b) => (b.cpsMicro > a.cpsMicro ? 1 : b.cpsMicro < a.cpsMicro ? -1 : 0));
  return { opportunity, economics };
}

/** 312k, 8k, 10, 1.3M: the tile figures. */
export function compactNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return new Intl.NumberFormat("en-GB").format(n);
}
