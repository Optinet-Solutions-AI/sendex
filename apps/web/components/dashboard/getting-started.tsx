import type { BalanceTopUp } from "@sendex/core";
import { compactNumber, FORMULAS } from "@sendex/core";
import { Button, Card, Explained, KpiStrip } from "@sendex/ui";
import {
  BookOpen,
  CodeXml,
  LifeBuoy,
  Megaphone,
  MessageSquareMore,
  Radio,
  ShieldCheck,
  Upload,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { balanceFigure, DASHBOARD_FORMULAS, spendFigure } from "./explain";
import { FigureText } from "./figure";
import { int } from "./format";

export interface GettingStartedProps {
  kpis: { contacts: number; sent: number; spendMicro: number; sales: number };
  balanceMicro: number;
  /** Where the balance comes from and, for carriers, each one's share (D5-20 hover). */
  balanceSource: "carrier" | "ledger";
  balanceCarriers: ReadonlyArray<{ name: string; balanceMicro: number }>;
  /** Where the balance is topped up (D5-19): at the carrier, or in Billing. */
  topUp: BalanceTopUp;
  /** The worker's public address for the API reference, when deployed. */
  apiDocsUrl: string | null;
  docsUrl: string | null;
  supportUrl: string | null;
}

/**
 * The Getting Started tab of the spec: four KPI tiles, the "Start here" strip with the
 * balance, Common actions, "Go further" and "Need a hand?".
 */
export function GettingStarted({
  kpis,
  balanceMicro,
  balanceSource,
  balanceCarriers,
  topUp,
  apiDocsUrl,
  docsUrl,
  supportUrl,
}: GettingStartedProps) {
  const spend = spendFigure(kpis.spendMicro);
  const balance = balanceFigure({
    source: balanceSource,
    totalMicro: balanceMicro,
    carriers: balanceCarriers,
  });
  return (
    <div className="space-y-6" data-testid="getting-started">
      <KpiStrip
        items={[
          {
            label: (
              <Explained formula={DASHBOARD_FORMULAS.contactsInPeriod}>Contacts on file</Explained>
            ),
            value: compactNumber(kpis.contacts),
            testId: "kpi-contacts",
          },
          {
            label: <Explained formula={FORMULAS.sent}>Messages sent</Explained>,
            value: compactNumber(kpis.sent),
            testId: "kpi-sent",
          },
          {
            label: <Explained formula={spend.formula}>Spend</Explained>,
            value: <FigureText figure={spend} />,
            testId: "kpi-spend",
          },
          {
            label: <Explained formula={FORMULAS.sales}>Sales (FTD)</Explained>,
            value: int(kpis.sales),
            testId: "kpi-sales",
          },
        ]}
      />
      <Card className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted">
            Start here
          </div>
          <div className="text-sm text-ink">
            Upload a list, create a campaign, send a test batch, read the results.{" "}
            <Link href="/?tab=overview" className="text-navy underline-offset-2 hover:underline">
              View full report →
            </Link>
          </div>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-muted">
            <Explained formula={balance.formula}>Balance</Explained>
          </span>
          <span className="font-mono font-medium" data-testid="dashboard-balance">
            <FigureText figure={balance} />
          </span>
          <Link href="/billing" className="text-navy underline-offset-2 hover:underline">
            {topUp.linkLabel}
          </Link>
        </div>
      </Card>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-ink">Common actions</h2>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <ActionCard
            icon={<Upload />}
            title="Upload a contact list"
            text="Import a CSV of phone numbers and map the columns."
            links={[
              { href: "/lists", label: "Lists" },
              { href: "/segments", label: "Segments" },
            ]}
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
            icon={<ShieldCheck />}
            title="Test your SMS"
            text="Check a route delivers before you spend on a real send."
            links={[
              { href: "/routes/testing", label: "Send Test SMS" },
              { href: "/routes/testing", label: "Send single SMS" },
            ]}
          />
          <ActionCard
            icon={<Radio />}
            title="Platform routes"
            text="Countries you can reach on our gateways, with pricing."
            links={[
              { href: "/routes/platform", label: "Platform routes" },
              { href: "/routes/custom", label: "Connect SMS routes" },
            ]}
          />
          <ActionCard
            icon={<Wallet />}
            title={topUp.cardTitle}
            text={topUp.cardText}
            links={[{ href: "/billing", label: "Billing" }]}
          />
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-ink">Go further</h2>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <ActionCard
            icon={<CodeXml />}
            title="Integrate with the API"
            text="Create campaigns, send and read results from your own systems. SMPP on request."
            links={[
              ...(apiDocsUrl ? [{ href: apiDocsUrl, label: "API reference", external: true }] : []),
              { href: "/settings/api-tokens", label: "API tokens" },
            ]}
          />
          <ActionCard
            icon={<MessageSquareMore />}
            title="Send an OTP message"
            text="One-off transactional texts through the same routes, from the API."
            links={apiDocsUrl ? [{ href: apiDocsUrl, label: "Read how", external: true }] : []}
          />
          <ActionCard
            icon={<BookOpen />}
            title="Read the docs"
            text="How-to pages for every screen, from upload to conversions."
            links={docsUrl ? [{ href: docsUrl, label: "Documentation", external: true }] : []}
          />
        </div>
      </section>

      <Card className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-3">
          <LifeBuoy className="h-5 w-5 text-navy" aria-hidden="true" />
          <div>
            <div className="text-sm font-semibold text-ink">Need a hand?</div>
            <div className="text-sm text-muted">
              Routes, pricing, deliverability — a human answers.
            </div>
          </div>
        </div>
        {supportUrl ? (
          <Button variant="outline" asChild>
            <a href={supportUrl} target="_blank" rel="noreferrer">
              Contact support
            </a>
          </Button>
        ) : (
          <span className="text-sm text-muted">Ask your account manager.</span>
        )}
      </Card>
    </div>
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
  links: readonly { href: string; label: string; external?: boolean }[];
}) {
  return (
    <Card className="flex flex-col gap-2 p-4">
      <div className="text-navy [&>svg]:h-5 [&>svg]:w-5">{icon}</div>
      <div className="text-sm font-semibold text-ink">{title}</div>
      <p className="text-sm text-muted">{text}</p>
      <div className="mt-auto flex flex-wrap gap-3 pt-1 text-sm">
        {links.map((l) =>
          l.external ? (
            <a
              key={l.href + l.label}
              href={l.href}
              target="_blank"
              rel="noreferrer"
              className="text-navy underline-offset-2 hover:underline"
            >
              {l.label}
            </a>
          ) : (
            <Link
              key={l.href + l.label}
              href={l.href}
              className="text-navy underline-offset-2 hover:underline"
            >
              {l.label}
            </Link>
          ),
        )}
      </div>
    </Card>
  );
}
