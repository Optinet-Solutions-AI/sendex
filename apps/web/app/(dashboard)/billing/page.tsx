import { can, formatEur, LEDGER_KINDS } from "@sendex/core";
import {
  type CampaignSpendRow,
  type DailySummaryRow,
  dailySummary,
  db,
  listLedgerEntries,
  organisationBalance,
  spendByCampaign,
} from "@sendex/db";
import {
  Explained,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@sendex/ui";
import Link from "next/link";
import { AuthError, requireAction } from "../../../lib/auth";
import {
  BILLING_PAGE_SIZE,
  BILLING_TABS,
  type BillingQuery,
  type BillingTab,
  billingQueryString,
  dayRangeBounds,
  defaultSummaryRange,
  parseBillingQuery,
} from "../../../lib/billing-params";
import {
  explainBalance,
  explainCampaignSpend,
  explainNet,
  explainTotal,
  LOCAL_FORMULAS,
} from "../../../lib/explain";
import { formatNumber } from "../../../lib/format";
import type { SearchParams } from "../../../lib/lists-params";
import { Pagination } from "../pagination";
import { AuthErrorView } from "../require-org";
import { DepositForm } from "./deposit-form";
import { LedgerTable } from "./ledger-table";

export const dynamic = "force-dynamic";

const TAB_LABELS: Record<BillingTab, string> = {
  deposits: "Deposits",
  transactions: "Transactions",
  summary: "Summary",
};

const inputClass = "h-9 rounded-md border border-neutral-300 bg-white px-3 text-sm";
const linkButton =
  "inline-flex h-9 items-center rounded-md border border-neutral-300 bg-white px-4 text-sm font-medium hover:bg-neutral-100";

function Tabs({ active }: { active: BillingTab }) {
  return (
    <div
      role="tablist"
      aria-label="Billing sections"
      className="flex gap-1 border-b border-neutral-200"
    >
      {BILLING_TABS.map((tab) => (
        <Link
          key={tab}
          role="tab"
          aria-selected={active === tab}
          href={`/billing${billingQueryString({ tab })}`}
          className={`-mb-px border-b-2 px-3 py-2 text-sm ${
            active === tab
              ? "border-neutral-900 font-medium text-neutral-900"
              : "border-transparent text-neutral-500 hover:text-neutral-800"
          }`}
        >
          {TAB_LABELS[tab]}
        </Link>
      ))}
    </div>
  );
}

async function DepositsPanel({
  organisationId,
  query,
}: {
  organisationId: string;
  query: BillingQuery;
}) {
  const result = await listLedgerEntries(db(), organisationId, {
    kind: "deposit",
    page: query.page,
    pageSize: BILLING_PAGE_SIZE,
  });
  return (
    <div data-testid="deposits-panel">
      <LedgerTable rows={result.rows} emptyMessage="No deposits yet." showKind={false} />
      <Pagination
        page={query.page}
        pageSize={BILLING_PAGE_SIZE}
        total={result.total}
        href={(page) => `/billing${billingQueryString({ ...query, page })}`}
      />
    </div>
  );
}

async function TransactionsPanel({
  organisationId,
  query,
}: {
  organisationId: string;
  query: BillingQuery;
}) {
  const bounds = dayRangeBounds(query.from, query.to);
  const result = await listLedgerEntries(db(), organisationId, {
    kind: query.kind || undefined,
    from: bounds.from,
    to: bounds.to,
    page: query.page,
    pageSize: BILLING_PAGE_SIZE,
  });
  const exportHref = `/billing/export?report=transactions&${billingQueryString({ ...query, page: 1 }).slice(1)}`;
  return (
    <div data-testid="transactions-panel">
      <form method="get" action="/billing" className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="tab" value="transactions" />
        <label className="flex flex-col gap-1 text-xs text-neutral-600">
          Kind
          <select name="kind" defaultValue={query.kind} className={inputClass}>
            <option value="">All kinds</option>
            {LEDGER_KINDS.map((kind) => (
              <option key={kind} value={kind} className="capitalize">
                {kind}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-neutral-600">
          From
          <input type="date" name="from" defaultValue={query.from} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-neutral-600">
          To
          <input type="date" name="to" defaultValue={query.to} className={inputClass} />
        </label>
        <button type="submit" className={linkButton}>
          Filter
        </button>
        <a href={exportHref} className={linkButton}>
          Export CSV
        </a>
      </form>
      <div className="mt-4">
        <LedgerTable rows={result.rows} emptyMessage="No transactions match." />
      </div>
      <Pagination
        page={query.page}
        pageSize={BILLING_PAGE_SIZE}
        total={result.total}
        href={(page) => `/billing${billingQueryString({ ...query, page })}`}
      />
    </div>
  );
}

function signed(micro: bigint): string {
  return micro === 0n ? "—" : formatEur(micro);
}

function SummaryTable({ rows }: { rows: DailySummaryRow[] }) {
  const totals = rows.reduce(
    (acc, r) => ({
      depositsMicro: acc.depositsMicro + r.depositsMicro,
      debitsMicro: acc.debitsMicro + r.debitsMicro,
      refundsMicro: acc.refundsMicro + r.refundsMicro,
      adjustmentsMicro: acc.adjustmentsMicro + r.adjustmentsMicro,
      netMicro: acc.netMicro + r.netMicro,
      entries: acc.entries + r.entries,
    }),
    {
      depositsMicro: 0n,
      debitsMicro: 0n,
      refundsMicro: 0n,
      adjustmentsMicro: 0n,
      netMicro: 0n,
      entries: 0,
    },
  );
  const num = "text-right tabular-nums";
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Date</TableHead>
          <TableHead className="text-right">
            <Explained formula={LOCAL_FORMULAS.deposits}>Deposits</Explained>
          </TableHead>
          <TableHead className="text-right">
            <Explained formula={LOCAL_FORMULAS.debits}>Debits</Explained>
          </TableHead>
          <TableHead className="text-right">
            <Explained formula={LOCAL_FORMULAS.refunds}>Refunds</Explained>
          </TableHead>
          <TableHead className="text-right">
            <Explained formula={LOCAL_FORMULAS.adjustments}>Adjustments</Explained>
          </TableHead>
          <TableHead className="text-right">
            <Explained formula={LOCAL_FORMULAS.net}>Net</Explained>
          </TableHead>
          <TableHead className="text-right">
            <Explained formula={LOCAL_FORMULAS.entries}>Entries</Explained>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 ? (
          <TableRow>
            <TableCell colSpan={7} className="h-24 text-center text-neutral-500">
              No activity in this range.
            </TableCell>
          </TableRow>
        ) : (
          rows.map((row) => (
            <TableRow key={row.day} data-testid={`summary-row-${row.day}`}>
              <TableCell className="whitespace-nowrap">{row.day}</TableCell>
              <TableCell className={num}>{signed(row.depositsMicro)}</TableCell>
              <TableCell className={num}>
                <Explained formula={row.debitsMicro === 0n ? null : LOCAL_FORMULAS.debits}>
                  {signed(row.debitsMicro)}
                </Explained>
              </TableCell>
              <TableCell className={num}>{signed(row.refundsMicro)}</TableCell>
              <TableCell className={num}>{signed(row.adjustmentsMicro)}</TableCell>
              <TableCell className={`${num} font-medium`}>
                <Explained {...explainNet(row)}>{formatEur(row.netMicro)}</Explained>
              </TableCell>
              <TableCell className={num}>{formatNumber(row.entries)}</TableCell>
            </TableRow>
          ))
        )}
        {rows.length > 0 ? (
          <TableRow className="bg-neutral-50 font-medium">
            <TableCell>Total</TableCell>
            {(["depositsMicro", "debitsMicro", "refundsMicro", "adjustmentsMicro"] as const).map(
              (key) => (
                <TableCell key={key} className={num}>
                  <Explained
                    formula={totals[key] === 0n ? null : LOCAL_FORMULAS.total}
                    working={explainTotal(
                      rows.filter((r) => r[key] !== 0n).map((r) => signed(r[key])),
                      signed(totals[key]),
                      "days",
                    )}
                  >
                    {signed(totals[key])}
                  </Explained>
                </TableCell>
              ),
            )}
            <TableCell className={num}>
              <Explained
                formula={LOCAL_FORMULAS.total}
                working={explainTotal(
                  rows.map((r) => formatEur(r.netMicro)),
                  formatEur(totals.netMicro),
                  "days",
                )}
                note={explainNet(totals).working}
              >
                {formatEur(totals.netMicro)}
              </Explained>
            </TableCell>
            <TableCell className={num}>
              <Explained
                formula={LOCAL_FORMULAS.total}
                working={explainTotal(
                  rows.map((r) => formatNumber(r.entries)),
                  formatNumber(totals.entries),
                  "days",
                )}
              >
                {formatNumber(totals.entries)}
              </Explained>
            </TableCell>
          </TableRow>
        ) : null}
      </TableBody>
    </Table>
  );
}

function CampaignSpendTable({ rows }: { rows: CampaignSpendRow[] }) {
  const num = "text-right tabular-nums";
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Campaign</TableHead>
          <TableHead className="text-right">
            <Explained formula={LOCAL_FORMULAS.campaignMessages}>Messages</Explained>
          </TableHead>
          <TableHead className="text-right">
            <Explained formula={LOCAL_FORMULAS.campaignDebits}>Debits</Explained>
          </TableHead>
          <TableHead className="text-right">
            <Explained formula={LOCAL_FORMULAS.campaignRefunds}>Refunds</Explained>
          </TableHead>
          <TableHead className="text-right">
            <Explained formula={LOCAL_FORMULAS.campaignSpend}>Spend</Explained>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 ? (
          <TableRow>
            <TableCell colSpan={5} className="h-16 text-center text-neutral-500">
              No campaign spend in this range.
            </TableCell>
          </TableRow>
        ) : (
          rows.map((row) => (
            <TableRow key={row.campaignId}>
              <TableCell>
                <Link href={`/campaigns/${row.campaignId}`} className="hover:underline">
                  {row.campaignName}
                </Link>
              </TableCell>
              <TableCell className={num}>{formatNumber(row.messages)}</TableCell>
              <TableCell className={num}>{signed(row.debitsMicro)}</TableCell>
              <TableCell className={num}>{signed(row.refundsMicro)}</TableCell>
              <TableCell className={`${num} font-medium`}>
                <Explained {...explainCampaignSpend(row)}>{formatEur(-row.netMicro)}</Explained>
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}

async function SummaryPanel({
  organisationId,
  query,
}: {
  organisationId: string;
  query: BillingQuery;
}) {
  const fallback = defaultSummaryRange();
  const from = query.from || fallback.from;
  const to = query.to || fallback.to;
  const bounds = dayRangeBounds(from, to);
  if (!bounds.from || !bounds.to) throw new Error("unreachable");
  const range = { from: bounds.from, to: bounds.to };
  const [days, campaigns] = await Promise.all([
    dailySummary(db(), organisationId, range),
    spendByCampaign(db(), organisationId, range),
  ]);
  const exportHref = `/billing/export?report=summary&from=${from}&to=${to}`;
  return (
    <div data-testid="summary-panel">
      <form method="get" action="/billing" className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="tab" value="summary" />
        <label className="flex flex-col gap-1 text-xs text-neutral-600">
          From
          <input type="date" name="from" defaultValue={from} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-neutral-600">
          To
          <input type="date" name="to" defaultValue={to} className={inputClass} />
        </label>
        <button type="submit" className={linkButton}>
          Apply
        </button>
        <a href={exportHref} className={linkButton}>
          Download report CSV
        </a>
      </form>
      <h2 className="mt-4 text-sm font-semibold">Daily summary</h2>
      <div className="mt-2">
        <SummaryTable rows={days} />
      </div>
      <h2 className="mt-6 text-sm font-semibold">Spend by campaign</h2>
      <div className="mt-2">
        <CampaignSpendTable rows={campaigns} />
      </div>
    </div>
  );
}

/**
 * Billing, like SMS Edge: the balance, Deposits / Transactions / Summary tabs and the
 * "Fund your account" panel. Reads go through `packages/db` scoped by organisation; the
 * deposit goes through `recordDepositAction`.
 */
export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  let ctx: Awaited<ReturnType<typeof requireAction>>;
  try {
    ctx = await requireAction("settings.view");
  } catch (error) {
    if (error instanceof AuthError) return <AuthErrorView error={error} />;
    throw error;
  }
  const query = parseBillingQuery(await searchParams);
  const balance = await organisationBalance(db(), ctx.organisationId);
  const onCarrier = balance.source === "carrier";
  const balanceExplained = explainBalance({
    source: balance.source,
    carriers: balance.carriers.map((c) => ({
      label: c.routeName,
      shown: formatEur(c.balanceMicro),
    })),
    shown: formatEur(balance.totalMicro),
  });
  const panel =
    query.tab === "deposits" ? (
      <DepositsPanel organisationId={ctx.organisationId} query={query} />
    ) : query.tab === "transactions" ? (
      <TransactionsPanel organisationId={ctx.organisationId} query={query} />
    ) : (
      <SummaryPanel organisationId={ctx.organisationId} query={query} />
    );
  return (
    <section>
      <PageHeader
        breadcrumb={[{ label: "Settings" }, { label: "Billing" }]}
        title="Billing"
        subtitle={
          <>
            <Explained formula={balanceExplained.formula}>Current balance</Explained>{" "}
            <span data-testid="billing-balance" className="font-mono font-medium text-ink">
              <Explained {...balanceExplained}>{formatEur(balance.totalMicro)}</Explained>
            </span>
            {onCarrier ? (
              <span data-testid="billing-balance-source">
                {" "}
                at{" "}
                {balance.carriers
                  .map(
                    (c) =>
                      `${c.routeName} ${formatEur(c.balanceMicro)} (read ${c.checkedAt
                        .toISOString()
                        .slice(0, 16)
                        .replace("T", " ")} UTC)`,
                  )
                  .join(", ")}
              </span>
            ) : null}
          </>
        }
        actions={
          can(ctx.role, "settings.manage") ? (
            <Link href="/settings/billing" className={linkButton}>
              Low balance alert and caps
            </Link>
          ) : null
        }
      />
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0">
          <Tabs active={query.tab} />
          <div role="tabpanel" className="pt-4">
            {panel}
          </div>
        </div>
        {onCarrier ? (
          <p className="text-sm text-muted" data-testid="carrier-balance-note">
            The balance is the money on our account at the carrier, read every minute and again
            before each send. Top it up at the carrier; deposits here do not change it. The history
            on the left still lists what each send cost.
          </p>
        ) : (
          <DepositForm canDeposit={can(ctx.role, "balance.deposit")} />
        )}
      </div>
    </section>
  );
}
