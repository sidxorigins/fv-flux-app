"use client";

import * as React from "react";
import { ChevronRight } from "lucide-react";

import type { MemberActiveTasks as MemberTasks } from "@/features/manager/queries";
import { formatDueDate, PriorityBadge, StatusBadge } from "@/features/tasks/components";
import { cn } from "@/lib/utils";

/**
 * THE headline widget: every member the manager oversees, collapsed to a
 * name + active-count row by default, expanding to a dense table of their
 * complete non-DONE task list. Client only for the expand/collapse state —
 * the data itself is server-fetched and passed in whole. Rows never link out
 * (the query intentionally omits projectId — task keys/titles are enough to
 * scan); this stays a read-only overview, not a navigation surface.
 *
 * Collapse state is local (not persisted) — reopening the page always starts
 * collapsed, which keeps the page short and scannable for a manager with
 * many reports. Expand/collapse only animates height via a CSS grid-rows
 * trick... deliberately NOT used here: animating `grid-template-rows`
 * triggers layout the same as height would, so the panel opens instantly
 * (CLAUDE.md: transform/opacity only). The chevron rotation is the only
 * motion, and it's a transform.
 */
export function MemberActiveTasks({
  members,
  now,
}: {
  members: MemberTasks[];
  now?: Date;
}) {
  const [expanded, setExpanded] = React.useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const reference = now ?? new Date();

  function toggle(userId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  if (members.length === 0) {
    return (
      <p className="text-muted-foreground py-8 text-center text-sm">
        No team members yet
      </p>
    );
  }

  return (
    <ul className="divide-border flex flex-col divide-y">
      {members.map((member) => {
        const isOpen = expanded.has(member.userId);
        const panelId = `member-tasks-${member.userId}`;
        const count = member.tasks.length;

        return (
          <li key={member.userId} className="py-2 first:pt-0 last:pb-0">
            <button
              type="button"
              aria-expanded={isOpen}
              aria-controls={panelId}
              onClick={() => toggle(member.userId)}
              className={cn(
                "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left",
                "transition-colors duration-150 hover:bg-surface-raised/70 motion-reduce:transition-none",
                "outline-none focus-visible:ring-ring/50 focus-visible:ring-2",
              )}
            >
              <ChevronRight
                aria-hidden
                className={cn(
                  "text-muted-foreground size-4 shrink-0 transition-transform duration-150 motion-reduce:transition-none",
                  isOpen && "rotate-90",
                )}
              />
              <span className="text-foreground truncate text-sm font-medium">
                {member.name}
              </span>
              <span className="text-muted-foreground truncate text-xs">
                @{member.username}
              </span>
              <span
                className={cn(
                  "ml-auto shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums",
                  count > 0
                    ? "bg-info/10 text-info"
                    : "bg-surface-raised text-muted-foreground",
                )}
              >
                {count} active
              </span>
            </button>

            {isOpen ? (
              <div id={panelId} role="region" className="mt-1.5 pl-6">
                {count === 0 ? (
                  <p className="text-muted-foreground py-2 text-xs">
                    No active tasks.
                  </p>
                ) : (
                  <div className="border-border overflow-x-auto rounded-lg border">
                    <table className="w-full min-w-[640px] text-left text-xs">
                      <thead>
                        <tr className="border-border text-muted-foreground border-b">
                          <th scope="col" className="px-2.5 py-1.5 font-medium">Key</th>
                          <th scope="col" className="px-2.5 py-1.5 font-medium">Title</th>
                          <th scope="col" className="px-2.5 py-1.5 font-medium">Project</th>
                          <th scope="col" className="px-2.5 py-1.5 font-medium">Status</th>
                          <th scope="col" className="px-2.5 py-1.5 font-medium">Priority</th>
                          <th scope="col" className="px-2.5 py-1.5 font-medium">Due</th>
                          <th scope="col" className="px-2.5 py-1.5 text-right font-medium">Est</th>
                          <th scope="col" className="px-2.5 py-1.5 text-right font-medium">Actual</th>
                        </tr>
                      </thead>
                      <tbody>
                        {member.tasks.map((task) => {
                          const dueDate = task.dueDate ? new Date(task.dueDate) : null;
                          const isOverdue =
                            dueDate !== null && dueDate.getTime() < reference.getTime();
                          return (
                            <tr
                              key={task.id}
                              className="border-border/60 last:border-b-0 border-b"
                            >
                              <td className="text-muted-foreground px-2.5 py-1.5 font-mono whitespace-nowrap">
                                {task.key}
                              </td>
                              <td className="text-foreground max-w-64 truncate px-2.5 py-1.5">
                                {task.title}
                              </td>
                              <td className="text-muted-foreground px-2.5 py-1.5 whitespace-nowrap">
                                {task.projectKey}
                              </td>
                              <td className="px-2.5 py-1.5">
                                <StatusBadge status={task.status} />
                              </td>
                              <td className="px-2.5 py-1.5">
                                <PriorityBadge priority={task.priority} />
                              </td>
                              <td
                                className={cn(
                                  "px-2.5 py-1.5 whitespace-nowrap tabular-nums",
                                  isOverdue ? "text-danger" : "text-muted-foreground",
                                )}
                              >
                                {dueDate ? formatDueDate(dueDate) : "—"}
                              </td>
                              <td className="text-muted-foreground px-2.5 py-1.5 text-right tabular-nums">
                                {task.estimatedHours ?? "—"}
                              </td>
                              <td className="text-muted-foreground px-2.5 py-1.5 text-right tabular-nums">
                                {task.actualHours}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
