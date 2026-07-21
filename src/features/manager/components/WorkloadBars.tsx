import type { WorkloadRow } from "@/features/manager/queries";
import { cn } from "@/lib/utils";

/**
 * Per-member workload — horizontal bars sized by active (non-DONE) task
 * count, hours logged as a caption. Server component: bar widths are plain
 * percentages computed at render time, no client JS and nothing animated
 * (CLAUDE.md: only transform/opacity may animate, and a static bar needs no
 * motion to read clearly). Every scoped member appears, even at zero, so an
 * idle member is visible rather than silently missing.
 */
export function WorkloadBars({ data }: { data: WorkloadRow[] }) {
  if (data.length === 0) {
    return (
      <p className="text-muted-foreground py-8 text-center text-sm">
        No team members yet
      </p>
    );
  }

  const sorted = [...data].sort((a, b) => b.activeCount - a.activeCount);
  const max = Math.max(1, ...sorted.map((row) => row.activeCount));

  return (
    <ul className="flex flex-col gap-3">
      {sorted.map((row) => {
        const pct = Math.round((row.activeCount / max) * 100);
        return (
          <li key={row.userId} className="flex items-center gap-3">
            <div className="w-28 min-w-0 shrink-0">
              <p className="text-foreground truncate text-sm">{row.name}</p>
              <p className="text-muted-foreground truncate text-[11px] tabular-nums">
                {row.actualHours}h logged
              </p>
            </div>
            <div
              className="bg-surface-raised h-2 min-w-0 flex-1 overflow-hidden rounded-full"
              role="img"
              aria-label={`${row.name}: ${row.activeCount} active ${row.activeCount === 1 ? "task" : "tasks"}`}
            >
              <div
                className={cn(
                  "h-full rounded-full",
                  row.activeCount > 0 ? "bg-info" : "bg-transparent",
                )}
                style={{ width: `${row.activeCount > 0 ? Math.max(pct, 4) : 0}%` }}
              />
            </div>
            <span className="text-foreground w-6 shrink-0 text-right text-sm font-medium tabular-nums">
              {row.activeCount}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
