import { Skeleton } from "@/components/ui/skeleton"

// Solid-surface skeleton board columns (no glass — this is content). Shape
// mirrors the real header + tabs + board so there's no layout shift.
export default function ProjectLoading() {
  return (
    <div className="flex h-full min-h-0 flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Skeleton className="h-5 w-14" />
            <Skeleton className="h-6 w-48" />
          </div>
          <Skeleton className="h-4 w-72" />
        </div>
        <div className="flex items-center gap-3">
          <Skeleton className="h-6 w-24 rounded-full" />
          <Skeleton className="h-8 w-8 rounded-lg" />
        </div>
      </div>

      <Skeleton className="h-8 w-40 rounded-lg" />

      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="flex h-full w-72 shrink-0 flex-col gap-2 rounded-xl border border-border bg-surface p-3 lg:w-auto lg:flex-1"
          >
            <Skeleton className="h-4 w-20" />
            {Array.from({ length: 3 }).map((_, j) => (
              <Skeleton key={j} className="h-20 w-full rounded-lg" />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
