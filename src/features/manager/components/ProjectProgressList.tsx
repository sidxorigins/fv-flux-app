import type { ProjectProgress } from "@/features/manager/queries";

/**
 * Done/total progress per scoped project. Server component, static bars (no
 * animation needed — CLAUDE.md reserves motion for feedback/state changes,
 * not for a number that's already correct on first paint). Projects with
 * zero tasks still appear at 0%, not hidden.
 */
export function ProjectProgressList({ data }: { data: ProjectProgress[] }) {
  if (data.length === 0) {
    return (
      <p className="text-muted-foreground py-8 text-center text-sm">
        No projects yet
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {data.map((project) => {
        const pct =
          project.total > 0
            ? Math.round((project.done / project.total) * 100)
            : 0;
        return (
          <li key={project.projectId} className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2">
                <span className="bg-primary/10 text-primary shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[11px] font-medium">
                  {project.key}
                </span>
                <span className="text-foreground truncate text-sm">
                  {project.name}
                </span>
              </span>
              <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                {project.done}/{project.total}
              </span>
            </div>
            <div
              className="bg-surface-raised h-1.5 overflow-hidden rounded-full"
              role="img"
              aria-label={`${project.name}: ${project.done} of ${project.total} tasks done`}
            >
              <div
                className="bg-success h-full rounded-full"
                style={{ width: `${pct}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
