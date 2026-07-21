import { AlertTriangle } from "lucide-react";

import { StatusBadge } from "@/features/tasks/components";
import type { MemberProductivity } from "@/features/team/queries";
import type { TaskStatus } from "@/generated/prisma/enums";
import { cn } from "@/lib/utils";

const STATUS_CHIP_ORDER = [
  { status: "TODO" as TaskStatus, key: "todo" as const },
  { status: "IN_PROGRESS" as TaskStatus, key: "inProgress" as const },
  { status: "IN_REVIEW" as TaskStatus, key: "inReview" as const },
  { status: "DONE" as TaskStatus, key: "done" as const },
];

/**
 * One teammate's productivity snapshot — the card that makes up the `/team`
 * grid. Server-compatible (zero client JS, nothing animated): a static glass
 * KPI-style card, matching the "glass on chrome/KPI cards, not on every
 * scrolling list item" rule — team rosters are small, so per-card glass here
 * mirrors `KpiCard`/`ManagerTeamMembers`' team cards rather than a long task
 * list.
 *
 * Data is pre-shaped and pre-gated by `getTeamProductivity` — this component
 * trusts what it's given and does no fetching or access checks of its own.
 */
export function TeammateCard({ member }: { member: MemberProductivity }) {
  const working = member.availability === "working";

  return (
    <div className="glass flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col leading-tight">
          <span className="text-foreground truncate text-sm font-semibold">
            {member.name}
          </span>
          <span className="text-muted-foreground truncate font-mono text-xs">
            @{member.username}
          </span>
        </div>
        <span className="flex shrink-0 items-center gap-1.5 text-xs">
          <span
            aria-hidden
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              working ? "bg-success" : "bg-muted-foreground",
            )}
          />
          <span className={working ? "text-success" : "text-muted-foreground"}>
            {working ? "Working" : "Idle"}
          </span>
        </span>
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Completion</span>
          <span className="text-foreground font-medium tabular-nums">
            {member.completionPct}%
          </span>
        </div>
        <div
          className="bg-surface-raised h-1.5 w-full overflow-hidden rounded-full"
          role="img"
          aria-label={`${member.completionPct}% of ${member.total} tasks complete`}
        >
          <div
            className="bg-success h-full rounded-full"
            style={{ width: `${member.completionPct}%` }}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {STATUS_CHIP_ORDER.map(({ status, key }) => (
          <span key={status} className="inline-flex items-center gap-1">
            <StatusBadge status={status} />
            <span className="text-foreground text-[11px] font-semibold tabular-nums">
              {member.counts[key]}
            </span>
          </span>
        ))}
        {member.counts.overdue > 0 ? (
          <span className="bg-danger/10 text-danger inline-flex h-5 shrink-0 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium whitespace-nowrap">
            <AlertTriangle aria-hidden className="size-3 shrink-0" />
            {member.counts.overdue} overdue
          </span>
        ) : null}
      </div>

      <div className="border-border grid grid-cols-3 gap-2 border-t pt-3 text-center">
        <div className="flex flex-col">
          <span className="text-foreground text-sm font-semibold tabular-nums">
            {member.estimatedHours}h
          </span>
          <span className="text-muted-foreground text-[11px]">Est</span>
        </div>
        <div className="flex flex-col">
          <span className="text-foreground text-sm font-semibold tabular-nums">
            {member.actualHours}h
          </span>
          <span className="text-muted-foreground text-[11px]">Actual</span>
        </div>
        <div className="flex flex-col">
          <span className="text-foreground text-sm font-semibold tabular-nums">
            {member.activeCount}
          </span>
          <span className="text-muted-foreground text-[11px]">Active</span>
        </div>
      </div>
    </div>
  );
}
