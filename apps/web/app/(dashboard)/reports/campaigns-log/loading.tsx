import { Skeleton } from "@sendex/ui";

/** Grey skeleton bars while the log loads, as the spec shows. */
export default function CampaignsLogLoading() {
  const rows = Array.from({ length: 8 }, (_, i) => `log-skeleton-${i}`);
  return (
    <section className="space-y-4" aria-busy="true" data-testid="log-loading">
      <div className="space-y-2">
        <Skeleton className="h-3 w-48" />
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-3 w-80" />
      </div>
      <Skeleton className="h-9 w-72" />
      <Skeleton className="h-20 w-full" />
      <div className="space-y-2 rounded-lg border border-rule bg-surface p-3">
        {rows.map((id) => (
          <Skeleton key={id} className="h-4 w-full" />
        ))}
      </div>
    </section>
  );
}
