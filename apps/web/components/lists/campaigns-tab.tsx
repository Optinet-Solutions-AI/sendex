import { EmptyState } from "@sendex/ui";
import { Megaphone } from "lucide-react";
import Link from "next/link";
import { formatDateTime, formatNumber } from "../../lib/format";
import { CampaignStatusBadge } from "../campaigns/campaigns-table";
import type { CampaignStatus } from "../campaigns/types";

export interface ListCampaignView {
  id: string;
  name: string;
  status: CampaignStatus;
  laps: number;
  sent: number;
  clicks: number;
  ctr: number;
  costMicro: number;
  firstLapAt: string | null;
  lastLapAt: string | null;
}

const TH =
  "whitespace-nowrap px-3 py-2.5 text-left font-mono text-[11px] font-semibold uppercase tracking-[0.07em] text-muted";
const TD = "px-3 py-2.5 text-sm";
const NUM = `${TD} text-right font-mono tabular-nums`;

const eur = (micro: number) =>
  `€${(micro / 1_000_000).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The Campaigns tab: campaigns that sent to this list, or the spec's empty state. */
export function CampaignsTab({ rows }: { rows: ListCampaignView[] }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<Megaphone />}
        title="No campaigns yet"
        hint="No campaigns have sent messages to this list yet."
      />
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-rule bg-surface">
      <table className="w-full text-sm" data-testid="list-campaigns-table">
        <thead className="bg-page">
          <tr>
            <th className={TH}>Campaign</th>
            <th className={TH}>Status</th>
            <th className={`${TH} text-right`}>Laps</th>
            <th className={`${TH} text-right`}>Sent</th>
            <th className={`${TH} text-right`}>Clicks</th>
            <th className={`${TH} text-right`}>CTR</th>
            <th className={`${TH} text-right`}>Cost</th>
            <th className={TH}>Period</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t border-rule">
              <td className={`${TD} font-medium`}>
                <Link href={`/campaigns/${row.id}`} className="text-ink hover:underline">
                  {row.name}
                </Link>
              </td>
              <td className={TD}>
                <CampaignStatusBadge status={row.status} />
              </td>
              <td className={NUM}>{formatNumber(row.laps)}</td>
              <td className={NUM}>{formatNumber(row.sent)}</td>
              <td className={NUM}>{formatNumber(row.clicks)}</td>
              <td className={NUM}>{(row.ctr * 100).toFixed(2)}%</td>
              <td className={NUM}>{eur(row.costMicro)}</td>
              <td className={`${TD} whitespace-nowrap text-muted`}>
                {row.firstLapAt ? formatDateTime(row.firstLapAt) : "--"}
                {row.lastLapAt ? ` → ${formatDateTime(row.lastLapAt)}` : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
