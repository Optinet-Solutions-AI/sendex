import { Skeleton } from "@sendex/ui";

/** Skeleton blocks while a dashboard tab loads. */
export default function DashboardLoading() {
  const cards = Array.from({ length: 4 }, (_, i) => `dash-skeleton-${i}`);
  return (
    <section className="space-y-5" aria-busy="true" data-testid="dashboard-loading">
      <div className="space-y-2">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-7 w-56" />
      </div>
      <Skeleton className="h-9 w-[36rem] max-w-full" />
      <Skeleton className="h-20 w-full" />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {cards.map((id) => (
          <Skeleton key={id} className="h-32 w-full" />
        ))}
      </div>
    </section>
  );
}
