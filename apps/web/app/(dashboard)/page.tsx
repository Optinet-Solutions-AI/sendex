import { formatEur } from "@sendex/core";
import { db, getBalanceMicro, getDashboardTotals } from "@sendex/db";
import { Button, Card, KpiStrip, PageHeader } from "@sendex/ui";
import { Megaphone, Radio, Upload, Wallet } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { NewCampaignModal } from "../../components/campaigns/new-campaign-modal";
import { RequireOrg } from "./require-org";

const number = new Intl.NumberFormat("en-GB");

/** Compact figures for the tiles: 312k, 8k, 10. */
function compact(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : number.format(n);
}

/**
 * The dashboard's Getting Started tab: four KPI tiles, "Start here" with the balance, and the
 * common actions. The other tabs (Overview, ROI, Countries, Contacts, Assets, API Usage)
 * arrive with the reports phase of the parity plan.
 */
export default function DashboardPage() {
  return (
    <RequireOrg>
      {async (ctx) => {
        const [totals, balanceMicro] = await Promise.all([
          getDashboardTotals(db(), ctx.organisationId),
          getBalanceMicro(db(), ctx.organisationId),
        ]);
        return (
          <section className="space-y-6">
            <PageHeader
              breadcrumb={[{ label: "SMS" }, { label: "Dashboard" }]}
              title="SMS Dashboard"
              actions={
                <>
                  <Button variant="outline" asChild>
                    <Link href="/lists/upload">
                      <Upload className="h-4 w-4" aria-hidden="true" /> Upload Contacts
                    </Link>
                  </Button>
                  <NewCampaignModal />
                </>
              }
            />
            <KpiStrip
              items={[
                {
                  label: "Contacts on file",
                  value: compact(totals.contacts),
                  testId: "kpi-contacts",
                },
                { label: "Messages sent", value: compact(totals.sent), testId: "kpi-sent" },
                {
                  label: "Spend",
                  value: `€${compact(Number(totals.spendMicro / 1_000_000n))}`,
                  testId: "kpi-spend",
                },
                { label: "Sales (FTD)", value: number.format(totals.sales), testId: "kpi-sales" },
              ]}
            />
            <Card className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div>
                <div className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted">
                  Start here
                </div>
                <div className="text-sm text-ink">
                  Upload a list, create a campaign, send a test batch, read the results.
                </div>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <span className="text-muted">Balance</span>
                <span className="font-mono font-medium" data-testid="dashboard-balance">
                  {formatEur(balanceMicro)}
                </span>
                <Link href="/billing" className="text-navy underline-offset-2 hover:underline">
                  Top up
                </Link>
              </div>
            </Card>
            <div>
              <h2 className="mb-2 text-sm font-semibold text-ink">Common actions</h2>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <ActionCard
                  icon={<Upload />}
                  title="Upload a contact list"
                  text="Import a CSV of phone numbers and map the columns."
                  links={[{ href: "/lists", label: "Lists" }]}
                />
                <ActionCard
                  icon={<Megaphone />}
                  title="Create a campaign"
                  text="Pick an audience, write the message, schedule the send."
                  links={[
                    { href: "/campaigns", label: "All campaigns" },
                    { href: "/settings/postbacks", label: "Conversion pixel" },
                  ]}
                />
                <ActionCard
                  icon={<Radio />}
                  title="Platform routes"
                  text="Countries you can reach on our gateways, with pricing."
                  links={[{ href: "/campaigns", label: "Pick routes in a campaign" }]}
                />
                <ActionCard
                  icon={<Wallet />}
                  title="Add balance"
                  text="Top up the account so campaigns can start sending."
                  links={[{ href: "/billing", label: "Billing" }]}
                />
              </div>
            </div>
            <p className="text-xs text-muted">
              Organisation <span className="font-mono">{ctx.organisationId}</span> · your role is{" "}
              {ctx.role}
            </p>
          </section>
        );
      }}
    </RequireOrg>
  );
}

function ActionCard({
  icon,
  title,
  text,
  links,
}: {
  icon: ReactNode;
  title: string;
  text: string;
  links: readonly { href: string; label: string }[];
}) {
  return (
    <Card className="flex flex-col gap-2 p-4">
      <div className="text-navy [&>svg]:h-5 [&>svg]:w-5">{icon}</div>
      <div className="text-sm font-semibold text-ink">{title}</div>
      <p className="text-sm text-muted">{text}</p>
      <div className="mt-auto flex flex-wrap gap-3 pt-1 text-sm">
        {links.map((l) => (
          <Link
            key={l.href + l.label}
            href={l.href}
            className="text-navy underline-offset-2 hover:underline"
          >
            {l.label}
          </Link>
        ))}
      </div>
    </Card>
  );
}
