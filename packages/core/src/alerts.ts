import { type AlertKind, isAlertKind } from "./caps.js";

/**
 * How the dashboard banner shows open alerts (D5-24): one line per kind, in plain words.
 * The stored message stays as it is (audit log, settings); these only shape the banner.
 */

export const ALERT_KIND_LABELS: Record<AlertKind, string> = {
  daily_message_cap: "Daily message cap",
  daily_spend_cap: "Daily spend cap",
  send_spike: "Sending spike",
  low_balance: "Low balance",
};

export function alertKindLabel(kind: string): string {
  return isAlertKind(kind) ? ALERT_KIND_LABELS[kind] : kind;
}

export interface AlertLike {
  kind: string;
  message: string;
  details: unknown;
}

const grouped = new Intl.NumberFormat("en-GB");

function numberAt(details: unknown, key: string): number | null {
  if (typeof details !== "object" || details === null) return null;
  const value = (details as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** The message without the alert's own name in front ("Sending spike: …" → "…"). */
function withoutLabel(kind: string, message: string): string {
  const prefix = `${alertKindLabel(kind)}:`;
  return message.startsWith(prefix) ? message.slice(prefix.length).trim() : message;
}

/**
 * One short line for an alert. A sending spike reads "2,850 SMS in one hour, about 56× the
 * usual 51 an hour."; when the week before averaged under one SMS an hour the multiple means
 * nothing (11,200×), so it says the week was quiet instead.
 */
export function alertSummary(alert: AlertLike): string {
  if (alert.kind === "send_spike") {
    const lastHour = numberAt(alert.details, "lastHour");
    const average = numberAt(alert.details, "sevenDayHourlyAverage");
    if (lastHour !== null && average !== null) {
      const sent = `${grouped.format(lastHour)} SMS in one hour`;
      if (average <= 0) return `${sent}, after a quiet week.`;
      if (average < 1) return `${sent}, after an almost quiet week.`;
      const times = grouped.format(Math.round(lastHour / average));
      return `${sent}, about ${times}× the usual ${grouped.format(Math.round(average))} an hour.`;
    }
  }
  return withoutLabel(alert.kind, alert.message);
}

export interface AlertGroup<T> {
  kind: string;
  /** The newest alert of the kind. */
  latest: T;
  /** The others, newest first. */
  earlier: T[];
  /** Every alert id of the kind, newest first (for "Acknowledge all"). */
  ids: string[];
}

/** One group per kind, newest first within a group; groups ordered by their newest alert. */
export function groupAlerts<T extends { id: string; kind: string; raisedAt: Date }>(
  alerts: readonly T[],
): AlertGroup<T>[] {
  const sorted = [...alerts].sort((a, b) => b.raisedAt.getTime() - a.raisedAt.getTime());
  const byKind = new Map<string, T[]>();
  for (const alert of sorted) byKind.set(alert.kind, [...(byKind.get(alert.kind) ?? []), alert]);
  const groups: AlertGroup<T>[] = [];
  for (const [kind, list] of byKind) {
    const [latest, ...earlier] = list;
    if (!latest) continue;
    groups.push({ kind, latest, earlier, ids: list.map((a) => a.id) });
  }
  return groups;
}
