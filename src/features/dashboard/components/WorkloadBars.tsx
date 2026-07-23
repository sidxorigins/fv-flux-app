import type { WorkloadEntry } from "@/features/dashboard/queries";

const MAX_ROWS = 6;

/**
 * Compact workload list-bars: name, thin proportional bar, count. Server
 * component, zero JS — replaces the WorkloadBar chart canvas on the dashboard,
 * which rendered a near-empty 120px+ canvas for one or two assignees.
 */
export function WorkloadBars({ data }: { data: WorkloadEntry[] }) {
  if (data.length === 0) {
    return <p className="text-muted-foreground text-sm">No open tasks assigned.</p>;
  }

  const shown = data.slice(0, MAX_ROWS);
  const hidden = data.length - shown.length;
  const max = Math.max(1, ...shown.map((d) => d.openTasks));

  return (
    <ul className="flex flex-col gap-2">
      {shown.map((entry) => (
        <li key={entry.userId} className="flex items-center gap-2 text-sm">
          <span className="text-foreground w-24 shrink-0 truncate" title={entry.name}>
            {entry.name}
          </span>
          <span
            aria-hidden
            className="bg-surface-raised h-1.5 min-w-0 flex-1 overflow-hidden rounded-full"
          >
            <span
              className="bg-info block h-full rounded-full"
              style={{ width: `${(entry.openTasks / max) * 100}%` }}
            />
          </span>
          <span className="text-muted-foreground w-6 shrink-0 text-right text-xs tabular-nums">
            {entry.openTasks}
          </span>
        </li>
      ))}
      {hidden > 0 ? (
        <li className="text-muted-foreground text-xs">+{hidden} more</li>
      ) : null}
    </ul>
  );
}
