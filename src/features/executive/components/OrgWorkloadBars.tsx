import type { OrgWorkloadEntry } from "../queries";

/**
 * Open tasks per person org-wide. Each bar is proportional to the busiest
 * person; the overdue portion is drawn in --danger inside the same bar, so
 * "loaded" and "late" read as one shape rather than two numbers.
 */
export function OrgWorkloadBars({ data }: { data: OrgWorkloadEntry[] }) {
  if (data.length === 0) {
    return <p className="text-muted-foreground text-sm">No open tasks assigned.</p>;
  }

  const max = Math.max(1, ...data.map((d) => d.openTasks));

  return (
    <ul className="flex flex-col gap-2">
      {data.map((entry) => {
        const overdue = Math.min(entry.overdueTasks, entry.openTasks);
        return (
          <li key={entry.userId} className="flex items-center gap-2 text-sm">
            <span className="text-foreground w-28 shrink-0 truncate" title={entry.name}>
              {entry.name}
            </span>
            <span
              aria-hidden
              className="bg-surface-raised flex h-1.5 min-w-0 flex-1 overflow-hidden rounded-full"
            >
              <span
                className="bg-danger block h-full"
                style={{ width: `${(overdue / max) * 100}%` }}
              />
              <span
                className="bg-info block h-full"
                style={{ width: `${((entry.openTasks - overdue) / max) * 100}%` }}
              />
            </span>
            <span className="text-muted-foreground w-16 shrink-0 text-right text-xs tabular-nums">
              {entry.openTasks}
              {overdue > 0 ? <span className="text-danger"> ({overdue})</span> : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
