"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarDays, Check, ChevronDown } from "lucide-react";
import { toast } from "sonner";

import type { TaskStatus } from "@/generated/prisma/enums";
import type { BoardTask } from "@/features/tasks/types";
import { updateTaskStatus } from "@/features/tasks/actions";
// Deep imports so the board + dnd-kit never enter the dashboard bundle.
import {
  StatusBadge,
  STATUS_META,
  STATUS_ORDER,
} from "@/features/tasks/components/StatusBadge";
import { PriorityBadge } from "@/features/tasks/components/PriorityBadge";
import { TypeIcon } from "@/features/tasks/components/TypeIcon";
import { formatDueDate } from "@/features/tasks/components/TaskCard";
import { useClientNow } from "@/features/tasks/components/hooks";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/**
 * Dense "my work" rows for the dashboard: key · type · title · priority · due ·
 * inline status. The row body is a stretched link into the task's board
 * (`/projects/<projectId>?task=<id>`); the status chip is a dropdown layered
 * above it that calls the updateTaskStatus server action.
 */
export function MyWorkList({ tasks }: { tasks: BoardTask[] }) {
  const router = useRouter();
  const now = useClientNow();
  const [pendingId, setPendingId] = React.useState<string | null>(null);
  const [, startTransition] = React.useTransition();

  if (tasks.length === 0) {
    return (
      <p className="text-muted-foreground py-8 text-center text-sm">
        Nothing assigned to you — enjoy the calm.
      </p>
    );
  }

  function changeStatus(task: BoardTask, status: TaskStatus) {
    if (status === task.status || pendingId) return;
    setPendingId(task.id);
    startTransition(async () => {
      const result = await updateTaskStatus(task.id, status);
      if (!result.ok) {
        toast.error(result.error);
      } else {
        router.refresh();
      }
      setPendingId(null);
    });
  }

  return (
    <ul className="-mx-2 flex flex-col">
      {tasks.map((task) => {
        const dueDate = task.dueDate ? new Date(task.dueDate) : null;
        const isOverdue =
          dueDate !== null && now !== null && dueDate.getTime() < now.getTime();
        const pending = pendingId === task.id;

        return (
          <li
            key={task.id}
            className={cn(
              "relative flex items-center gap-2.5 rounded-lg px-2 py-2",
              "hover:bg-surface-raised/70 transition-colors duration-150 motion-reduce:transition-none",
              pending && "opacity-60",
            )}
          >
            <span className="text-muted-foreground w-16 shrink-0 truncate font-mono text-xs">
              {task.key}
            </span>
            <TypeIcon type={task.type} className="size-3.5" />

            {/* Stretched link: covers the whole row; controls below sit above it */}
            <Link
              href={`/projects/${task.projectId}?task=${task.id}`}
              className={cn(
                "text-foreground min-w-0 flex-1 truncate text-sm font-medium",
                "rounded outline-none after:absolute after:inset-0 after:rounded-lg",
                "focus-visible:after:ring-ring/50 focus-visible:after:ring-2",
              )}
            >
              {task.title}
            </Link>

            <PriorityBadge
              priority={task.priority}
              className="hidden sm:inline-flex"
            />

            <span
              className={cn(
                "hidden w-16 shrink-0 items-center justify-end gap-1 text-[11px] tabular-nums sm:flex",
                isOverdue ? "text-danger" : "text-muted-foreground",
              )}
              aria-label={
                dueDate
                  ? `Due ${formatDueDate(dueDate)}${isOverdue ? ", overdue" : ""}`
                  : undefined
              }
            >
              {dueDate ? (
                <>
                  <CalendarDays aria-hidden className="size-3 shrink-0" />
                  {formatDueDate(dueDate)}
                </>
              ) : null}
            </span>

            <span className="relative z-10 shrink-0">
              <DropdownMenu>
                <DropdownMenuTrigger
                  disabled={pending}
                  aria-label={`Change status of ${task.key}`}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-md outline-none",
                    "focus-visible:ring-ring/50 focus-visible:ring-2",
                  )}
                >
                  <StatusBadge status={task.status} />
                  <ChevronDown
                    aria-hidden
                    className="text-muted-foreground size-3"
                  />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-40">
                  {STATUS_ORDER.map((status) => (
                    <DropdownMenuItem
                      key={status}
                      onClick={() => changeStatus(task, status)}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          "size-2 rounded-full",
                          STATUS_META[status].dotClass,
                        )}
                      />
                      {STATUS_META[status].label}
                      {status === task.status ? (
                        <Check aria-hidden className="ml-auto size-3.5" />
                      ) : null}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
