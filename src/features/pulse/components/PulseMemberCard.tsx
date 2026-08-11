import { AlertTriangle, Clock, Timer } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { PriorityBadge } from "@/features/tasks/components/PriorityBadge";
import { formatElapsed } from "@/features/pulse/shape";
import type { PulseMember } from "@/features/pulse/queries";
import { cn } from "@/lib/utils";

// Imported from the concrete module paths rather than the
// features/tasks/components barrel: the barrel re-exports client components
// (Board, TaskDrawer…), and pulling those into a Server Component render is
// what broke /explore before. PriorityBadge and shape.ts are both plain
// non-"use client" modules, so they are safe here.

function initialsOf(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0] ?? "")
      .join("")
      .toUpperCase() || "?"
  );
}

/**
 * One person's card on the org Pulse board — who they are, what they're on
 * right now, and the few numbers worth glancing at.
 *
 * Server component by design: zero client JS and nothing animated, so a wall
 * display can hold 16 of these without a hydration cost. Data arrives
 * pre-shaped and pre-gated from `getOrgPulse()` — this component does no
 * fetching and no access checks of its own (same contract as TeammateCard).
 *
 * `wall` scales type and spacing up for the 85" office display; the default
 * is the desk-sized card used at /admin/pulse.
 */
export function PulseMemberCard({
  member,
  wall = false,
}: {
  member: PulseMember;
  wall?: boolean;
}) {
  const working = member.availability === "working";
  const task = member.currentTask;

  return (
    <div className={cn("glass flex flex-col gap-3", wall ? "gap-4 p-6" : "p-4")}>
      {/* Identity + live state */}
      <div className="flex items-center gap-3">
        <Avatar size={wall ? "lg" : "default"}>
          {member.avatarUrl ? <AvatarImage src={member.avatarUrl} alt="" /> : null}
          <AvatarFallback className={wall ? "text-base font-medium" : "font-medium"}>
            {initialsOf(member.name)}
          </AvatarFallback>
        </Avatar>

        <div className="flex min-w-0 flex-col leading-tight">
          <span
            className={cn(
              "text-foreground truncate font-semibold",
              wall ? "text-xl" : "text-sm",
            )}
          >
            {member.name}
          </span>
          <span
            className={cn(
              "text-muted-foreground truncate font-mono",
              wall ? "text-sm" : "text-xs",
            )}
          >
            @{member.username}
          </span>
        </div>

        <span
          className={cn(
            "ml-auto flex shrink-0 items-center gap-1.5",
            wall ? "text-base" : "text-xs",
          )}
        >
          <span
            aria-hidden
            className={cn(
              "shrink-0 rounded-full",
              wall ? "size-2.5" : "size-1.5",
              working ? "bg-success" : "bg-muted-foreground",
            )}
          />
          <span className={working ? "text-success" : "text-muted-foreground"}>
            {working ? "Working" : "Idle"}
          </span>
        </span>
      </div>

      {/* What they're on right now — the whole point of this board */}
      {task ? (
        <div
          className={cn(
            "bg-surface-raised flex flex-col gap-1.5 rounded-lg",
            wall ? "p-4" : "p-3",
          )}
        >
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "text-muted-foreground shrink-0 font-mono",
                wall ? "text-sm" : "text-[11px]",
              )}
            >
              {task.projectKey}
            </span>
            <span
              className={cn(
                "text-foreground shrink-0 font-mono font-semibold",
                wall ? "text-sm" : "text-[11px]",
              )}
            >
              {task.key}
            </span>
            <span className="ml-auto shrink-0">
              <PriorityBadge priority={task.priority} />
            </span>
          </div>

          <p
            className={cn(
              "text-foreground line-clamp-2 font-medium",
              wall ? "text-lg leading-snug" : "text-sm",
            )}
          >
            {task.title}
          </p>

          {task.minutesOnTask !== null ? (
            <span
              className={cn(
                "text-muted-foreground inline-flex items-center gap-1.5",
                wall ? "text-sm" : "text-xs",
              )}
            >
              {task.hasRunningTimer ? (
                <Timer aria-hidden className={wall ? "size-4" : "size-3"} />
              ) : (
                <Clock aria-hidden className={wall ? "size-4" : "size-3"} />
              )}
              {formatElapsed(task.minutesOnTask)} on this
            </span>
          ) : null}
        </div>
      ) : (
        <div
          className={cn(
            "border-border text-muted-foreground rounded-lg border border-dashed text-center",
            wall ? "p-4 text-base" : "p-3 text-xs",
          )}
        >
          No task in progress
        </div>
      )}

      {/* Numbers worth a glance */}
      <div
        className={cn(
          "border-border grid grid-cols-4 gap-2 border-t text-center",
          wall ? "pt-4" : "pt-3",
        )}
      >
        <Stat wall={wall} value={member.activeCount} label="Open" />
        <Stat
          wall={wall}
          value={member.inReview}
          label="Review"
          tone={member.inReview > 0 ? "warning" : undefined}
        />
        <Stat
          wall={wall}
          value={member.overdue}
          label="Overdue"
          tone={member.overdue > 0 ? "danger" : undefined}
          icon={member.overdue > 0}
        />
        <Stat
          wall={wall}
          value={member.completedThisWeek}
          label="Done wk"
          tone={member.completedThisWeek > 0 ? "success" : undefined}
        />
      </div>
    </div>
  );
}

function Stat({
  value,
  label,
  tone,
  icon = false,
  wall,
}: {
  value: number;
  label: string;
  tone?: "danger" | "warning" | "success";
  icon?: boolean;
  wall: boolean;
}) {
  return (
    <div className="flex flex-col">
      <span
        className={cn(
          "inline-flex items-center justify-center gap-1 font-semibold tabular-nums",
          wall ? "text-2xl" : "text-sm",
          tone === "danger" && "text-danger",
          tone === "warning" && "text-warning",
          tone === "success" && "text-success",
          !tone && "text-foreground",
        )}
      >
        {icon ? <AlertTriangle aria-hidden className={wall ? "size-5" : "size-3"} /> : null}
        {value}
      </span>
      <span className={cn("text-muted-foreground", wall ? "text-sm" : "text-[11px]")}>
        {label}
      </span>
    </div>
  );
}
