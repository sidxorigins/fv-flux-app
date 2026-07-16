import { Skeleton } from "@/components/ui/skeleton";

/** Solid-surface skeleton card — no glass on skeletons (nothing to refract). */
function SkeletonPanel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`border-border bg-surface flex flex-col gap-4 rounded-2xl border p-5 ${className ?? ""}`}
    >
      {children}
    </div>
  );
}

/**
 * Skeleton bento mirroring the real dashboard layout so the swap to live data
 * doesn't shift anything. Default pulse only — no shimmer, no stagger.
 */
export default function DashboardLoading() {
  return (
    <div className="flex flex-col gap-6" aria-busy>
      <Skeleton className="h-8 w-40" />

      {/* KPI row */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonPanel key={i} className="gap-3">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-8 w-14" />
            <Skeleton className="h-3 w-20" />
          </SkeletonPanel>
        ))}
      </div>

      {/* Main bento */}
      <div className="grid items-start gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <SkeletonPanel>
            <Skeleton className="h-3 w-20" />
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </SkeletonPanel>
          <SkeletonPanel>
            <Skeleton className="h-3 w-44" />
            <Skeleton className="h-[200px] w-full" />
          </SkeletonPanel>
          <SkeletonPanel>
            <Skeleton className="h-3 w-48" />
            <Skeleton className="h-[160px] w-full" />
          </SkeletonPanel>
        </div>

        <div className="flex flex-col gap-4">
          <SkeletonPanel>
            <Skeleton className="h-3 w-32" />
            <Skeleton className="mx-auto size-[180px] rounded-full" />
            <Skeleton className="h-10 w-full" />
          </SkeletonPanel>
          <SkeletonPanel>
            <Skeleton className="h-3 w-28" />
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-6 w-full" />
            ))}
          </SkeletonPanel>
        </div>
      </div>

      {/* Project tiles */}
      <div className="flex flex-col gap-3">
        <Skeleton className="h-3 w-20" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonPanel key={i} className="gap-3 p-4">
              <Skeleton className="h-5 w-12" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-20" />
            </SkeletonPanel>
          ))}
        </div>
      </div>
    </div>
  );
}
