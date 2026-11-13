"use client";

import { countryName, outsideSendingHours, type SendingHours } from "@sendex/core";
import { useEffect, useState } from "react";

/**
 * The yellow "outside suggested sending hours" notice of the send form (D4-14). It compares
 * the send time (now for Send Now, else the scheduled start) with the organisation's hours
 * for the campaign's country, in the campaign's time zone. A suggestion only: nothing is
 * disabled. Renders nothing inside the hours, without hours, or before the clock is known.
 */
export function SendingHoursNotice({
  hours,
  country,
  timezone,
  scheduledAt,
}: {
  hours: SendingHours;
  country: string;
  timezone: string;
  /** ISO start time of a scheduled send; null for Send Now. */
  scheduledAt: string | null;
}) {
  // The current time is only known in the browser; it ticks so the notice follows the clock.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const at = scheduledAt ? new Date(scheduledAt) : now;
  if (at === null || Number.isNaN(at.getTime())) return null;
  const outside = outsideSendingHours(hours, country, timezone, at);
  if (outside === null) return null;
  const { window, localTime } = outside;
  return (
    <p
      role="status"
      data-testid="sending-hours-notice"
      className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
    >
      Outside the suggested sending hours for {countryName(country)} ({window.from}–{window.to}
      ): {scheduledAt ? "it will be" : "it is"} {localTime} there
      {scheduledAt ? " at the scheduled start" : " now"}. You can still send.
    </p>
  );
}
