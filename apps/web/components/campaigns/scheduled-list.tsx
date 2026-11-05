import { countryName, flagEmoji } from "@sendex/core";
import Link from "next/link";
import type { CampaignStatus } from "./types";
import { StatusBadge } from "./ui";

export interface ScheduledCampaignView {
  id: string;
  name: string;
  country: string;
  timezone: string;
  status: CampaignStatus;
  /** UTC ISO instant. */
  scheduledAt: string;
  /** `HH:mm` in the campaign timezone. */
  localTime: string;
  lapsCount: number;
  smsCount: number;
}

export interface ScheduledDayView {
  /** `YYYY-MM-DD` in the campaign timezone. */
  day: string;
  campaigns: ScheduledCampaignView[];
}

const dayLabel = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/** "2099-01-11" -> "Sun 11 Jan 2099" (the day is already a local calendar day). */
export function formatDay(day: string): string {
  return dayLabel.format(new Date(`${day}T12:00:00Z`));
}

const number = new Intl.NumberFormat("en-GB");

/** Upcoming sends grouped per calendar day of each campaign's own timezone. */
export function ScheduledList({ days }: { days: ScheduledDayView[] }) {
  if (days.length === 0) {
    return (
      <p className="text-sm text-neutral-500" data-testid="scheduled-empty">
        Nothing is scheduled in this period. Set a start time on a campaign's Schedule panel and
        press Send to queue it.
      </p>
    );
  }
  return (
    <div className="space-y-6">
      {days.map((group) => (
        <section key={group.day} data-testid="scheduled-day" data-day={group.day}>
          <h2 className="mb-2 text-sm font-semibold text-neutral-700">{formatDay(group.day)}</h2>
          <div className="overflow-x-auto rounded border border-neutral-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-left text-xs uppercase text-neutral-500">
                <tr>
                  <th className="px-3 py-2">Local time</th>
                  <th className="px-3 py-2">Campaign</th>
                  <th className="px-3 py-2">Country</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">Laps</th>
                  <th className="px-3 py-2 text-right">SMS</th>
                </tr>
              </thead>
              <tbody>
                {group.campaigns.map((c) => (
                  <tr
                    key={c.id}
                    className="border-t border-neutral-100"
                    data-testid="scheduled-row"
                    data-campaign-id={c.id}
                  >
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">
                      {c.localTime} <span className="font-sans text-neutral-500">{c.timezone}</span>
                    </td>
                    <td className="px-3 py-2 font-medium">
                      <Link href={`/campaigns/${c.id}`} className="hover:underline">
                        {c.name}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      {flagEmoji(c.country)} {countryName(c.country)}
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={c.status} />
                    </td>
                    <td className="px-3 py-2 text-right">{c.lapsCount}</td>
                    <td className="px-3 py-2 text-right">{number.format(c.smsCount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
