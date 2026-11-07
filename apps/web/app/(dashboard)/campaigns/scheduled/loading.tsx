import { Skeleton } from "@sendex/ui";

/** Skeleton blocks while the calendar loads, as the spec shows. */
export default function SendCalendarLoading() {
  const cells = Array.from({ length: 35 }, (_, i) => `calendar-skeleton-${i}`);
  return (
    <section className="space-y-5" aria-busy="true" data-testid="calendar-loading">
      <div className="space-y-2">
        <Skeleton className="h-3 w-48" />
        <Skeleton className="h-7 w-56" />
      </div>
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-8 w-80" />
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-rule bg-rule">
        {cells.map((id) => (
          <div key={id} className="min-h-[6.5rem] bg-surface p-2">
            <Skeleton className="h-4 w-6" />
          </div>
        ))}
      </div>
    </section>
  );
}
