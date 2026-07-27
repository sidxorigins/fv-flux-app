import Link from "next/link";
import { Lock } from "lucide-react";

import { cn } from "@/lib/utils";
import { projectPath } from "@/features/tasks/share";
import { HEALTH_META } from "../health";
import type { ExecutiveProject } from "../queries";

const SPARK_WEEKS = 6;

/**
 * Six-week completion sparkline as CSS bars — no charting library, no client
 * JS, no layout animation. `weeks` may be short or empty when a project has no
 * completions in the window; it is left-padded to SPARK_WEEKS so every card's
 * strip is the same width and the cards stay on one grid.
 */
function Sparkline({ weeks }: { weeks: number[] }) {
  const padded = [
    ...Array.from({ length: Math.max(0, SPARK_WEEKS - weeks.length) }, () => 0),
    ...weeks.slice(-SPARK_WEEKS),
  ];
  const max = Math.max(1, ...padded);
  const total = padded.reduce((sum, n) => sum + n, 0);

  return (
    <div
      role="img"
      aria-label={
        total === 0
          ? "No tasks completed in the last 6 weeks"
          : `${total} tasks completed over the last 6 weeks`
      }
      className="flex h-6 items-end gap-1"
    >
      {padded.map((count, i) => (
        <span
          key={i}
          className={cn(
            "min-h-[2px] flex-1 rounded-sm",
            count === 0 ? "bg-surface-raised" : "bg-success/60",
          )}
          style={{ height: `${(count / max) * 100}%` }}
        />
      ))}
    </div>
  );
}

/**
 * One project, at a glance. Server component, zero JS.
 *
 * A project the viewer has no ProjectMembership for renders as a NON-LINK with
 * a lock — the Overview is org-wide but drill-down stays membership-gated.
 */
export function ProjectHealthCard({ project }: { project: ExecutiveProject }) {
  const meta = HEALTH_META[project.health];
  const pct =
    project.total === 0 ? 0 : Math.round((project.done / project.total) * 100);

  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <span className="text-muted-foreground font-mono text-[11px]">
            {project.key}
          </span>
          <span className="text-foreground truncate text-sm font-medium">
            {project.name}
          </span>
        </div>
        <span
          className={cn(
            "inline-flex h-5 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-[11px] font-medium whitespace-nowrap",
            meta.chipClass,
          )}
        >
          <span className={cn("size-1.5 rounded-full", meta.dotClass)} aria-hidden />
          {meta.label}
        </span>
      </div>

      <div className="flex flex-col gap-1">
        <div className="text-muted-foreground flex items-baseline justify-between text-[11px]">
          <span>
            {project.done} of {project.total} done
          </span>
          <span className="tabular-nums">{pct}%</span>
        </div>
        <span aria-hidden className="bg-surface-raised h-1.5 overflow-hidden rounded-full">
          <span
            className="bg-success block h-full rounded-full"
            style={{ width: `${pct}%` }}
          />
        </span>
      </div>

      <dl className="text-muted-foreground grid grid-cols-3 gap-2 text-[11px]">
        <div className="flex flex-col">
          <dt>Open</dt>
          <dd className="text-foreground tabular-nums">{project.open}</dd>
        </div>
        <div className="flex flex-col">
          <dt>In review</dt>
          <dd className="text-foreground tabular-nums">{project.inReview}</dd>
        </div>
        <div className="flex flex-col">
          <dt>Overdue</dt>
          <dd
            className={cn(
              "tabular-nums",
              project.overdue > 0 ? "text-danger" : "text-foreground",
            )}
          >
            {project.overdue}
          </dd>
        </div>
      </dl>

      <Sparkline weeks={project.spark} />

      <div className="text-muted-foreground flex items-center justify-between text-[11px]">
        <span className="truncate">Lead: {project.leadName}</span>
        <span className="flex items-center gap-1">
          {project.activity7d} updates / 7d
          {project.canOpen ? null : <Lock aria-hidden className="size-3" />}
        </span>
      </div>
    </>
  );

  // min-w-0 is load-bearing: the card is a grid item whose children use
  // `truncate` (white-space: nowrap), so without it the untruncated text feeds
  // max-content into the implicit grid column and the card renders wider than
  // the viewport. `body` has `overflow-x: clip`, so that overflow does NOT
  // produce a scrollbar — it silently clips content off-screen, unreachable.
  const shell = "glass flex min-w-0 flex-col gap-3 p-4";

  if (!project.canOpen) {
    return (
      <div
        className={cn(shell, "opacity-70")}
        title="No project access — ask an admin"
      >
        {body}
      </div>
    );
  }

  return (
    <Link
      href={projectPath(project.key)}
      className={cn(
        shell,
        "transition-colors duration-150 motion-reduce:transition-none",
        "hover:bg-surface-raised/50 outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
      )}
    >
      {body}
    </Link>
  );
}
