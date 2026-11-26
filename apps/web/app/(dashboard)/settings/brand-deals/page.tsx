import { can, suggestDealForOffer } from "@sendex/core";
import { currentBrandDeals, db, listOffersWithDeals } from "@sendex/db";
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  Explained,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@sendex/ui";
import { Handshake } from "lucide-react";
import { formatMicro } from "../../../../components/campaigns/format";
import { AuthError, requireAction } from "../../../../lib/auth";
import { explainCpaCounted, LOCAL_FORMULAS } from "../../../../lib/explain";
import { AuthErrorView } from "../../require-org";
import { DealsUpload } from "./deals-upload";
import { OfferDeals } from "./offer-deals";

export const dynamic = "force-dynamic";

/**
 * Brand deals (D5-16): what each brand pays us per first deposit, uploaded from the Media
 * Deals export, and which deal each offer earns from. Revenue everywhere in Sendex is the
 * CPA of the offer's deal in force on the day of each first deposit.
 */
export default async function BrandDealsPage() {
  let ctx: Awaited<ReturnType<typeof requireAction>>;
  try {
    ctx = await requireAction("settings.view");
  } catch (error) {
    if (error instanceof AuthError) return <AuthErrorView error={error} />;
    throw error;
  }
  const today = new Date().toISOString().slice(0, 10);
  const database = db();
  const [deals, offers] = await Promise.all([
    currentBrandDeals(database, ctx.organisationId, today),
    listOffersWithDeals(database, ctx.organisationId),
  ]);
  const canManage = can(ctx.role, "settings.manage");
  const options = deals.map((d) => ({
    key: d.key,
    brand: d.brand,
    label: `${d.brand} · ${d.program || "no program"} · ${
      d.cpaMicro === null ? "no price" : `${formatMicro(Number(d.cpaMicro))} CPA`
    }`,
  }));

  return (
    <section className="max-w-5xl space-y-6">
      <PageHeader
        breadcrumb={[{ label: "Settings", href: "/settings" }, { label: "Brand deals" }]}
        title="Brand deals"
        subtitle="What each brand pays us per first deposit, from the Media Deals export."
      />
      <p className="max-w-3xl text-sm text-muted">
        Revenue in Sendex comes only from these deals: each first deposit earns the CPA of its
        offer&apos;s deal, at the price in force that day. The amount the tracker sends with a
        deposit is not revenue. Revshare and base payments are not counted, and a deal without a
        euro CPA earns nothing until it has one.
      </p>

      {canManage ? <DealsUpload today={today} /> : null}

      <Card>
        <CardHeader title="Offers" note="Choose the deal each offer earns from" />
        {offers.length === 0 ? (
          <EmptyState
            icon={<Handshake />}
            title="No offers"
            hint="Offers are added on a campaign."
          />
        ) : (
          <OfferDeals
            canManage={canManage && deals.length > 0}
            options={options}
            offers={offers.map((o) => ({
              id: o.id,
              name: o.name,
              url: o.url,
              dealKey: o.dealKey,
              suggestion: o.dealKey === null ? suggestDealForOffer(o.name, deals) : null,
            }))}
          />
        )}
      </Card>

      <Card>
        <CardHeader title="Deals" note={`${deals.length} brands`} />
        {deals.length === 0 ? (
          <EmptyState
            icon={<Handshake />}
            title="No deals yet"
            hint="Upload the Media Deals export to add them."
          />
        ) : (
          <div className="overflow-x-auto">
            <Table data-testid="brand-deals-table">
              <TableHeader>
                <TableRow>
                  <TableHead>Brand</TableHead>
                  <TableHead>Program</TableHead>
                  <TableHead>Deal</TableHead>
                  <TableHead className="text-right">
                    <Explained formula={LOCAL_FORMULAS.cpaCounted}>CPA counted</Explained>
                  </TableHead>
                  <TableHead>From</TableHead>
                  <TableHead>Top geos</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {deals.map((d) => (
                  <TableRow key={d.key}>
                    <TableCell className="font-medium">{d.brand}</TableCell>
                    <TableCell>{d.program || "—"}</TableCell>
                    <TableCell className="max-w-xs whitespace-normal">{d.deal || "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      <Explained
                        {...explainCpaCounted(
                          d.deal,
                          d.cpaMicro === null ? null : formatMicro(Number(d.cpaMicro)),
                          d.reason,
                        )}
                      >
                        {d.cpaMicro === null ? (
                          <Badge variant="amber">{d.reason ?? "No price"}</Badge>
                        ) : (
                          formatMicro(Number(d.cpaMicro))
                        )}
                      </Explained>
                    </TableCell>
                    <TableCell className="tabular-nums">{d.startsOn}</TableCell>
                    <TableCell className="max-w-[12rem] whitespace-normal">
                      {d.topGeos || "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
    </section>
  );
}
