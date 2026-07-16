import { Skeleton } from "@/components/ui/skeleton";

// TODO: real dashboard (KPIs from grouped DB queries, my work, activity,
// charts) lands in a later phase — these shells prove the glass system.
const KPI_PLACEHOLDERS = [
  "My open tasks",
  "Due soon",
  "In review",
  "Completed this week",
] as const;

export default function DashboardPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">
        Dashboard
      </h1>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {KPI_PLACEHOLDERS.map((label) => (
          <div key={label} className="glass flex flex-col gap-3 p-5">
            <span className="text-sm text-muted-foreground">{label}</span>
            <Skeleton className="h-8 w-16" />
            <Skeleton className="h-3 w-24" />
          </div>
        ))}
      </div>
    </div>
  );
}
