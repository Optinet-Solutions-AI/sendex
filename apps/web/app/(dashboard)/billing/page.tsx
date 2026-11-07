import { can, formatEur, LEDGER_KINDS } from "@sendex/core";
import {
  type CampaignSpendRow,
  type DailySummaryRow,
  dailySummary,
  db,
  getBalanceMicro,
  listLedgerEntries,
  spendByCampaign,
} from "@sendex/db";
import {
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
          <TableHead className="text-right">Deposits</TableHead>
          <TableHead className="text-right">Debits</TableHead>
          <TableHead className="text-right">Refunds</TableHead>
          <TableHead className="text-right">Adjustments</TableHead>
          <TableHead className="text-right">Net</TableHead>
          <TableHead className="text-right">Entries</TableHead>
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
              <TableCell className={num}>{signed(row.debitsMicro)}</TableCell>
              <TableCell className={num}>{signed(row.refundsMicro)}</TableCell>
              <TableCell className={num}>{signed(row.adjustmentsMicro)}</TableCell>
              <TableCell className={`${num} font-medium`}>{formatEur(row.netMicro)}</TableCell>
              <TableCell className={num}>{formatNumber(row.entries)}</TableCell>
            </TableRow>
          ))
        )}
        {rows.length > 0 ? (
          <TableRow className="bg-neutral-50 font-medium">
            <TableCell>Total</TableCell>
            <TableCell className={num}>{signed(totals.depositsMicro)}</TableCell>
            <TableCell className={num}>{signed(totals.debitsMicro)}</TableCell>
            <TableCell className={num}>{signed(totals.refundsMicro)}</TableCell>
            <TableCell className={num}>{signed(totals.adjustmentsMicro)}</TableCell>
            <TableCell className={num}>{formatEur(totals.netMicro)}</TableCell>
            <TableCell className={num}>{formatNumber(totals.entries)}</TableCell>
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
          <TableHead className="text-right">Messages</TableHead>
          <TableHead className="text-right">Debits</TableHead>
          <TableHead className="text-right">Refunds</TableHead>
          <TableHead className="text-right">Spend</TableHead>
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
              <TableCell className={`${num} font-medium`}>{formatEur(-row.netMicro)}</TableCell>
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
  const balanceMicro = await getBalanceMicro(db(), ctx.organisationId);
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
            Current balance{" "}
            <span data-testid="billing-balance" className="font-mono font-medium text-ink">
              {formatEur(balanceMicro)}
            </span>
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
        <DepositForm canDeposit={can(ctx.role, "balance.deposit")} />
      </div>
    </section>
  );
}
